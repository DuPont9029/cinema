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
    // Create schema for progress
    await this.conn.query(`
            CREATE TABLE IF NOT EXISTS progress (
                series_name VARCHAR,
                season VARCHAR,
                episode_name VARCHAR,
                timestamp DOUBLE,
                duration DOUBLE,
                last_updated TIMESTAMP,
                completed BOOLEAN,
                PRIMARY KEY (series_name, season, episode_name)
            );
        `);
  }

  async syncFromS3(bucket) {
    // Try to load parquet file from S3
    // Tracking file is always in bucket/streamhub/progress_tracker.parquet
    const parquetUrl = `s3://${bucket}/streamhub/progress_tracker.parquet`;

    try {
      // Check if file exists by trying to read it
      // We use read_parquet with union_by_name to handle schema evolution if needed
      await this.conn.query(`
                INSERT OR REPLACE INTO progress 
                SELECT * FROM read_parquet('${parquetUrl}');
            `);
      console.log("Sync from S3 completed for bucket:", bucket);
    } catch (e) {
      console.log(
        "No remote progress file found or sync failed (first run?):",
        e
      );
    }
  }

  async syncToS3(bucket) {
    const parquetKey = `streamhub/progress_tracker.parquet`;
    const localFileName = "progress_tracker.parquet";

    try {
      console.log("Exporting progress to local parquet...");
      await this.conn.query(`
                COPY progress TO '${localFileName}' (FORMAT PARQUET);
            `);

      // Read file buffer from DuckDB virtual FS
      const buffer = await this.db.copyFileToBuffer(localFileName);

      console.log("Uploading to S3:", parquetKey);
      await window.s3Manager.uploadFile(
        parquetKey,
        buffer,
        "application/vnd.apache.parquet"
      );

      console.log("Sync to S3 completed");
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
    await this.conn.query(`
            INSERT OR REPLACE INTO progress VALUES (
                '${series.replace(/'/g, "''")}', 
                '${season.replace(/'/g, "''")}', 
                '${episode.replace(/'/g, "''")}', 
                ${timestamp}, 
                ${duration}, 
                now(), 
                ${completed}
            );
        `);
  }

  async getProgress(series, season, episode) {
    const result = await this.conn.query(`
            SELECT timestamp, completed FROM progress 
            WHERE series_name = '${series.replace(/'/g, "''")}' 
            AND season = '${season.replace(/'/g, "''")}'
            AND episode_name = '${episode.replace(/'/g, "''")}'
        `);
    return result.toArray();
  }

  async getSeriesProgress(series) {
    const result = await this.conn.query(`
            SELECT season, episode_name, timestamp, completed 
            FROM progress 
            WHERE series_name = '${series.replace(/'/g, "''")}'
        `);
    return result.toArray();
  }
}

export const dbManager = new DuckDBManager();
