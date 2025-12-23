class S3Manager {
  constructor() {
    this.s3Client = null;
    this.bucket = null;
    this.credentials = null;
  }

  init(endpoint, accessKeyId, secretAccessKey, bucket) {
    this.credentials = {
      accessKeyId,
      secretAccessKey,
    };
    this.bucket = bucket;
    this.endpoint = endpoint;

    // AWS SDK v3 Client
    const { S3Client } = window.AWS_SDK_S3 || window.aws_sdk_client_s3; // Handle different global names if needed, usually just AWS in v2 but v3 is modular.
    // With the CDN script I used: <script src="https://cdn.jsdelivr.net/npm/@aws-sdk/client-s3@3.370.0/dist/aws-sdk-client-s3.min.js"></script>
    // It exposes "window.aws_sdk_client_s3" usually or similar. I need to check the exact global.
    // For simplicity, let's assume the CDN exposes it or I might need a specific build.
    // Actually, most modern UMD builds expose a global variable.
    // Let's try to be safe. If window.aws_sdk_client_s3 is not defined, we might have an issue.
    // Common pattern for AWS SDK V3 browser script is `window.AWS` if using the full bundle, but here I used specific client.
    // Let's assume standard UMD export `window.AWS.S3`. Wait, V3 is different.

    // Let's try to access it via window first.
    // If this fails, I'll switch to V2 which is easier to use via CDN globally (AWS.S3).
    // But the user prompt implied modern stack.

    // Let's stick to the prompt's implied "modern" approach but make it work.
    // Actually, using V2 in browser is often easier for simple scripts without a bundler.
    // However, I already put V3 in the HTML.
    // Let's check the global variable for that CDN link.
    // usually it's `window['@aws-sdk/client-s3']` or similar.

    // To avoid guessing, I will switch the HTML to use AWS SDK V2 which is definitely `window.AWS`.
    // It's robust and works everywhere for these simple tasks.
    // OR I can use a bundled version of V3.

    // Let's stick with V3 but use a better import map or module approach if I can.
    // Since I'm writing vanilla JS, maybe V2 is safer.
    // User asked for "Mangadb" style. MangaDB uses `aws-sdk.min.js` which is likely V2.

    // I'll update `index.html` to use V2 for reliability in this context,
    // UNLESS I am sure about V3.
    // Let's try to use V3 with the specific global `aws_sdk_client_s3` which is common for some bundlers,
    // but to be safe, I'll update `index.html` to V2 in the next step if I can't find it.

    // Actually, let's write this class assuming `AWS` global (V2) or `S3Client` (V3).
    // I will use `AWS.S3` (V2) logic as fallback.
  }

  // We will use AWS SDK V2 logic for simplicity in a non-bundled environment
  // I will update index.html to pull AWS SDK V2.

  async connect(endpoint, accessKeyId, secretAccessKey, bucket) {
    this.bucket = bucket;
    this.endpoint = endpoint;
    this.credentials = { accessKeyId, secretAccessKey };

    AWS.config.update({
      accessKeyId: accessKeyId,
      secretAccessKey: secretAccessKey,
      endpoint: endpoint,
      s3ForcePathStyle: true, // Needed for many S3-compatible storages like Cubbit
      signatureVersion: "v4",
      region: "eu-central-1",
    });

    this.s3 = new AWS.S3();

    // Verify connection by listing bucket
    try {
      await this.s3.listObjectsV2({ Bucket: bucket, MaxKeys: 1 }).promise();
      return true;
    } catch (e) {
      console.error("S3 Connection failed:", e);
      throw e;
    }
  }

  setBucket(bucket) {
    this.bucket = bucket;
  }

  async listContents() {
    const params = {
      Bucket: this.bucket,
    };

    let allObjects = [];
    let isTruncated = true;
    let continuationToken = null;

    while (isTruncated) {
      if (continuationToken) params.ContinuationToken = continuationToken;

      const data = await this.s3.listObjectsV2(params).promise();
      if (data.Contents) {
        allObjects = allObjects.concat(data.Contents);
      }

      isTruncated = data.IsTruncated;
      continuationToken = data.NextContinuationToken;
    }

    return allObjects;
  }

  getSignedUrl(key) {
    return this.s3.getSignedUrl("getObject", {
      Bucket: this.bucket,
      Key: key,
      Expires: 3600 * 3, // 3 hours
    });
  }

  async uploadJson(key, data) {
    await this.s3
      .putObject({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(data),
        ContentType: "application/json",
      })
      .promise();
  }

  async uploadFile(key, body, contentType = "application/octet-stream") {
    await this.s3
      .putObject({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
      .promise();
  }

  async getJson(key) {
    try {
      const data = await this.s3
        .getObject({
          Bucket: this.bucket,
          Key: key,
        })
        .promise();
      return JSON.parse(data.Body.toString("utf-8"));
    } catch (e) {
      if (e.code === "NoSuchKey") return null;
      throw e;
    }
  }
}

// Global instance
window.s3Manager = new S3Manager();
