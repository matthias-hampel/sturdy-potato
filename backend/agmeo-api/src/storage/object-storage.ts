import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { config } from '../config.js';

/**
 * Object storage for uploaded and generated files. Keys are opaque paths
 * (`orgs/<orgId>/files/<fileId>`); names, folders and metadata live in the database.
 *
 * - `local`: a directory on disk, for development and tests.
 * - `s3`: any S3-compatible service (Hetzner Object Storage, AWS, MinIO).
 */
export interface StorageDriver {
  put(key: string, body: Readable | Buffer, contentType: string, size?: number): Promise<void>;
  get(key: string): Promise<Readable>;
  size(key: string): Promise<number | null>;
  delete(key: string): Promise<void>;
}

class LocalDriver implements StorageDriver {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string) {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error(`Invalid storage key ${key}`);
    return p;
  }

  async put(key: string, body: Readable | Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await pipeline(Buffer.isBuffer(body) ? Readable.from([body]) : body, createWriteStream(p));
  }

  async get(key: string) {
    const p = this.path(key);
    await stat(p);
    return createReadStream(p);
  }

  async size(key: string) {
    try {
      return (await stat(this.path(key))).size;
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}

class S3Driver implements StorageDriver {
  private readonly client: S3Client;
  constructor(private readonly bucket: string) {
    this.client = new S3Client({
      region: config.storage.s3.region,
      endpoint: config.storage.s3.endpoint || undefined,
      forcePathStyle: config.storage.s3.forcePathStyle,
      credentials: config.storage.s3.accessKeyId
        ? { accessKeyId: config.storage.s3.accessKeyId, secretAccessKey: config.storage.s3.secretAccessKey }
        : undefined,
    });
  }

  async put(key: string, body: Readable | Buffer, contentType: string, size?: number) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ContentLength: size }));
  }

  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return res.Body as Readable;
  }

  async size(key: string) {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return res.ContentLength ?? null;
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export function createStorageDriver(): StorageDriver {
  return config.storage.driver === 's3' ? new S3Driver(config.storage.s3.bucket) : new LocalDriver(config.storage.localDir);
}

@Injectable()
export class ObjectStorage {
  private readonly driver = createStorageDriver();
  put = this.driver.put.bind(this.driver);
  get = this.driver.get.bind(this.driver);
  size = this.driver.size.bind(this.driver);
  delete = this.driver.delete.bind(this.driver);
}
