import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  paginateListObjectsV2,
} from '@aws-sdk/client-s3';
import type { ObjectStorageConfig } from './config.js';

export interface StoredObject {
  bucket: string;
  key: string;
}

export class ObjectStorage {
  readonly bucket: string;
  readonly region: string;
  readonly prefix: string;
  private readonly client: S3Client;

  constructor(config: ObjectStorageConfig) {
    this.bucket = config.bucket;
    this.region = config.region;
    this.prefix = config.prefix;
    this.client = new S3Client({ region: config.region, maxAttempts: 4 });
  }

  async putCaseDocument(caseCode: string, filename: string, contentType: string, body: Buffer): Promise<StoredObject> {
    const key = `${this.casePrefix(caseCode)}${filename}`;
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
      ServerSideEncryption: 'AES256',
      Metadata: { 'case-code': caseCode },
    }));
    return { bucket: this.bucket, key };
  }

  async getObject(key: string): Promise<Buffer> {
    this.assertManagedKey(key);
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!response.Body) throw new Error('El objeto almacenado no contiene datos.');
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async deleteCase(caseCode: string): Promise<number> {
    const prefix = this.casePrefix(caseCode);
    let deleted = 0;
    for await (const page of paginateListObjectsV2({ client: this.client }, { Bucket: this.bucket, Prefix: prefix })) {
      const objects = (page.Contents || []).flatMap((item) => item.Key ? [{ Key: item.Key }] : []);
      if (!objects.length) continue;
      const response = await this.client.send(new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: objects, Quiet: true },
      }));
      if (response.Errors?.length) {
        throw new Error(`S3 no pudo eliminar ${response.Errors.length} objeto(s) del caso.`);
      }
      deleted += objects.length;
    }
    return deleted;
  }

  async deleteObjects(keys: string[]): Promise<number> {
    const uniqueKeys = [...new Set(keys)];
    if (!uniqueKeys.length) return 0;
    uniqueKeys.forEach((key) => this.assertManagedKey(key));
    const response = await this.client.send(new DeleteObjectsCommand({
      Bucket: this.bucket,
      Delete: { Objects: uniqueKeys.map((Key) => ({ Key })), Quiet: true },
    }));
    if (response.Errors?.length) {
      throw new Error(`S3 no pudo eliminar ${response.Errors.length} objeto(s) compensatorios.`);
    }
    return uniqueKeys.length;
  }

  private casePrefix(caseCode: string): string {
    if (!/^AFPC-\d{8}-\d{5,}$/u.test(caseCode)) throw new Error('El código de caso no es válido para S3.');
    return `${this.prefix}/${caseCode}/`;
  }

  private assertManagedKey(key: string): void {
    if (!key.startsWith(`${this.prefix}/AFPC-`)) {
      throw new Error('La llave S3 no pertenece al espacio administrado por Occidente.');
    }
  }
}
