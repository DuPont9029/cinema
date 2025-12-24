import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm";

class DuckDBManager {
  constructor() {
    this.db = null;
    this.conn = null;
  }

  async init(s3Config) {
    // Load DuckDB WASM
    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

    const worker_url = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], {
        type: "text/javascript",
      })
    );

    const worker = new Worker(worker_url);
    const logger = new duckdb.ConsoleLogger();
    this.db = new duckdb.AsyncDuckDB(logger, worker);
    await this.db.instantiate(bundle.mainModule, bundle.pthreadWorker);

    this.conn = await this.db.connect();

    // Configure S3 in DuckDB
    // Note: Cubbit/S3-compatible might need endpoint override
    // DuckDB S3 extension supports endpoint override via settings

    const useSSL = s3Config.endpoint.startsWith("https");
    const cleanEndpoint = s3Config.endpoint.replace(/^https?:\/\//, "");

    // Split initialization to ensure httpfs is loaded before setting config
    await this.conn.query(`
            INSTALL httpfs;
            LOAD httpfs;
        `);

    await this.conn.query(`
            SET s3_region='eu-central-1';
            SET s3_endpoint='${cleanEndpoint}';
            SET s3_access_key_id='${s3Config.accessKeyId}';
            SET s3_secret_access_key='${s3Config.secretAccessKey}';
            SET s3_url_style='path';
            SET s3_use_ssl=${useSSL};
        `);

    await this.initSchema();
  }

  async initSchema() {
    // Initial creation of empty table if needed (fallback)
    await this.conn.query(`
            CREATE TABLE IF NOT EXISTS progress (
                series_name VARCHAR,
                season VARCHAR,
                episode_name VARCHAR,
                timestamp DOUBLE,
                duration DOUBLE,
                last_updated TIMESTAMP,
                completed BOOLEAN
            );
        `);
  }

  async loadFromS3(bucket) {
    const key = `streamhub/progress_tracker.parquet`;
    const localFileName = "progress_tracker_loaded.parquet";

    try {
      console.log("Loading from S3 via SDK Download:", key);

      // Download file using S3 SDK (MangaDB logic)
      const parquetData = await window.s3Manager.downloadFile(key, bucket);

      if (!parquetData) {
        console.warn("No progress file found on S3. Initializing empty table.");
        await this.initSchema();
        return;
      }

      // Register buffer in DuckDB
      await this.db.registerFileBuffer(localFileName, parquetData);

      // Clear existing table and load new data
      await this.conn.query("DELETE FROM progress");

      await this.conn.query(`
          INSERT INTO progress 
          SELECT * FROM read_parquet('${localFileName}')
      `);

      console.log("Load from S3 completed and ingested into memory.");

      // Cleanup
      await this.db.dropFile(localFileName);
    } catch (e) {
      console.error("Load from S3 failed:", e);
      // Ensure we have a working table even if load fails
      await this.initSchema();
    }
  }

  // Alias for backward compatibility if needed, but we should use loadFromS3
  async syncFromS3(bucket) {
    return this.loadFromS3(bucket);
  }

  async syncToS3(bucket) {
    const parquetKey = `streamhub/progress_tracker.parquet`;
    const localFileName = "progress_tracker.parquet";

    try {
      console.log("Exporting progress to local parquet...");

      // DEBUG: Check what we are about to export
      const countResult = await this.conn.query(
        "SELECT count(*), sum(completed::int) FROM progress"
      );
      console.log("Stats before export:", countResult.toArray()[0]);

      // Use logic from MangaDB: Export to local file first, then upload via S3 SDK
      // Added OVERWRITE TRUE
      await this.conn.query(`
                COPY (SELECT * FROM progress ORDER BY series_name, season, episode_name) 
                TO '${localFileName}' (FORMAT PARQUET, OVERWRITE TRUE);
            `);

      // Read file buffer from DuckDB virtual FS
      const buffer = await this.db.copyFileToBuffer(localFileName);

      if (!buffer || buffer.length === 0) {
        console.error("Exported parquet file is empty!");
        return;
      }

      console.log(
        `Uploading to S3: ${parquetKey} (${buffer.length} bytes) to bucket: ${bucket}`
      );

      // Ensure we are using the correct bucket
      if (!bucket) {
        throw new Error("Bucket is undefined in syncToS3");
      }

      console.log(
        `[DuckDB] Starting syncToS3. Bucket: ${bucket}, Key: ${parquetKey}`
      );

      await window.s3Manager.uploadFile(
        parquetKey,
        buffer,
        "application/vnd.apache.parquet",
        bucket
      );

      // Clean up local file
      await this.db.dropFile(localFileName);

      console.log("Sync to S3 completed successfully via S3 SDK upload.");
    } catch (e) {
      console.error("Failed to sync to S3:", e);
      throw e;
    }
  }

  async updateProgress(
    series,
    season,
    episode,
    timestamp,
    duration,
    completed
  ) {
    console.log(
      `Updating progress: ${series} S${season} E${episode} - Time: ${timestamp}, Completed: ${completed}`
    );

    const sName = series.replace(/'/g, "''");
    const sSeason = season.replace(/'/g, "''");
    const sEpisode = episode.replace(/'/g, "''");

    // Use DELETE + INSERT to avoid primary key issues and ensure clean state
    await this.conn.query(`
            DELETE FROM progress 
            WHERE series_name = '${sName}' 
            AND season = '${sSeason}' 
            AND episode_name = '${sEpisode}';
    `);

    await this.conn.query(`
            INSERT INTO progress VALUES (
                '${sName}', 
                '${sSeason}', 
                '${sEpisode}', 
                ${timestamp}, 
                ${duration}, 
                now(), 
                ${completed}
            );
        `);

    // Verify update
    const check = await this.conn.query(`
        SELECT completed FROM progress 
        WHERE series_name = '${sName}' 
        AND episode_name = '${sEpisode}'
    `);
    console.log("Verification of update:", check.toArray());
  }

  async getProgress(series, season, episode) {
    try {
      const result = await this.conn.query(`
            SELECT timestamp, completed FROM progress 
            WHERE series_name = '${series.replace(/'/g, "''")}' 
            AND season = '${season.replace(/'/g, "''")}'
            AND episode_name = '${episode.replace(/'/g, "''")}'
        `);
      return result.toArray();
    } catch (e) {
      console.warn("Read from local progress failed:", e);
      return [];
    }
  }

  async getSeriesProgress(series) {
    try {
      const result = await this.conn.query(`
            SELECT season, episode_name, timestamp, completed 
            FROM progress 
            WHERE series_name = '${series.replace(/'/g, "''")}'
        `);
      return result.toArray();
    } catch (e) {
      console.warn("Read from local progress failed:", e);
      return [];
    }
  }
}

export const dbManager = new DuckDBManager();
