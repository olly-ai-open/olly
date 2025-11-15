import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";
import { gzip, gunzip } from "zlib";
import { promisify } from "util";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
});

const BUCKET_NAME = process.env.S3_DEBUG_BUCKET || "olly-debug-data";
const DEBUG_ENABLED = process.env.ENABLE_DEBUG_CAPTURE === "true";

export interface DebugDataStructure {
  version: string;
  summary: {
    briefId: string;
    userId: string;
    timestamp: string;
    totalDuration: number;
    apiCalls: number;
    success: boolean;
    error?: string;
  };
  timeline: Array<{
    timestamp: number;
    action: string;
    details?: string;
    query?: string;
    resultCount?: number;
    duration?: number;
    error?: string;
  }>;
  searchResults: {
    drive: {
      queries: string[];
      totalFound: number;
      included: number;
      results: any[];
      errors?: string[];
    };
    gmail: {
      queries: string[];
      totalFound: number;
      included: number;
      results: any[];
      errors?: string[];
    };
  };
  llmContext: {
    systemPrompt: string;
    userPrompt: string;
    model: string;
    temperature: number;
    response: string;
  };
}

export class S3DebugStorage {
  private bucketName: string;

  constructor(bucketName?: string) {
    this.bucketName = bucketName || BUCKET_NAME;
  }

  /**
   * Check if debug capture is enabled
   */
  static isEnabled(): boolean {
    return DEBUG_ENABLED;
  }

  /**
   * Generate S3 key for debug data
   */
  private getS3Key(userId: string, briefId: string, filename: string): string {
    return `briefs/${userId}/${briefId}/${filename}`;
  }

  /**
   * Upload debug data to S3 with compression
   */
  async uploadDebugData(
    briefId: string,
    userId: string,
    data: DebugDataStructure,
  ): Promise<{ success: boolean; s3Key?: string; error?: string }> {
    if (!DEBUG_ENABLED) {
      return { success: false, error: "Debug capture is disabled" };
    }

    try {
      const jsonData = JSON.stringify(data, null, 2);
      const compressed = await gzipAsync(jsonData);
      const s3Key = this.getS3Key(userId, briefId, "debug-data.json.gz");

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
        Body: compressed,
        ContentType: "application/gzip",
        ContentEncoding: "gzip",
        Metadata: {
          briefId,
          userId,
          timestamp: new Date().toISOString(),
        },
      });

      await s3Client.send(command);
      console.log(`Debug data uploaded to S3: ${s3Key}`);

      return { success: true, s3Key };
    } catch (error) {
      console.error("Failed to upload debug data to S3:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get presigned URL for downloading debug data
   */
  async getPresignedUrl(
    s3Key: string,
    expiresIn: number = 3600, // 1 hour default
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: s3Key,
    });

    return await getSignedUrl(s3Client, command, { expiresIn });
  }

  /**
   * Retrieve and decompress debug data from S3
   */
  async getDebugData(
    briefId: string,
    userId: string,
  ): Promise<DebugDataStructure | null> {
    try {
      const s3Key = this.getS3Key(userId, briefId, "debug-data.json.gz");

      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });

      const response = await s3Client.send(command);

      if (!response.Body) {
        return null;
      }

      // Convert stream to buffer
      const stream = response.Body as Readable;
      const chunks: any[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      // Decompress and parse
      const decompressed = await gunzipAsync(buffer);
      return JSON.parse(decompressed.toString());
    } catch (error) {
      console.error("Failed to retrieve debug data from S3:", error);
      return null;
    }
  }

  /**
   * Check if debug data exists for a brief
   */
  async debugDataExists(briefId: string, userId: string): Promise<boolean> {
    try {
      const s3Key = this.getS3Key(userId, briefId, "debug-data.json.gz");

      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });

      await s3Client.send(command);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete debug data for a brief
   */
  async deleteDebugData(
    briefId: string,
    userId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const s3Key = this.getS3Key(userId, briefId, "debug-data.json.gz");

      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });

      await s3Client.send(command);
      console.log(`Debug data deleted from S3: ${s3Key}`);

      return { success: true };
    } catch (error) {
      console.error("Failed to delete debug data from S3:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * List all debug files for a user
   */
  async listUserDebugFiles(userId: string): Promise<
    Array<{
      briefId: string;
      size: number;
      lastModified: Date;
    }>
  > {
    try {
      const prefix = `briefs/${userId}/`;

      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
      });

      const response = await s3Client.send(command);

      if (!response.Contents) {
        return [];
      }

      return response.Contents.filter((obj) =>
        obj.Key?.endsWith("debug-data.json.gz"),
      ).map((obj) => {
        const parts = obj.Key!.split("/");
        return {
          briefId: parts[2],
          size: obj.Size || 0,
          lastModified: obj.LastModified || new Date(),
        };
      });
    } catch (error) {
      console.error("Failed to list debug files:", error);
      return [];
    }
  }
}
