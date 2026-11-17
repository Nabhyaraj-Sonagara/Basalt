// Where encrypted file bodies live: a folder (default) or an S3 bucket.
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

export interface BlobStore {
  put(id: string, data: Buffer): Promise<void>;
  get(id: string): Promise<Buffer>;
  delete(id: string): Promise<void>;
}

const checkId = (id: string) => {
  if (!/^[a-f0-9]{32,64}$/.test(id)) throw new Error('bad blob id');
  return id;
};

export class DiskBlobStore implements BlobStore {
  constructor(readonly dir: string) {}
  private file(id: string) {
    checkId(id);
    return join(this.dir, id.slice(0, 2), id);
  }
  async put(id: string, data: Buffer) {
    const f = this.file(id);
    await fs.mkdir(dirname(f), { recursive: true });
    await fs.writeFile(`${f}.tmp`, data);
    await fs.rename(`${f}.tmp`, f);
  }
  get(id: string) {
    return fs.readFile(this.file(id));
  }
  async delete(id: string) {
    await fs.rm(this.file(id), { force: true });
  }
}

export async function s3BlobStore(o: { bucket: string; region?: string; prefix: string; endpoint?: string }): Promise<BlobStore> {
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: o.region, endpoint: o.endpoint, forcePathStyle: !!o.endpoint });
  const key = (id: string) => o.prefix + checkId(id);
  return {
    async put(id, data) {
      await s3.send(new PutObjectCommand({ Bucket: o.bucket, Key: key(id), Body: data, ContentType: 'application/octet-stream' }));
    },
    async get(id) {
      const res = await s3.send(new GetObjectCommand({ Bucket: o.bucket, Key: key(id) }));
      return Buffer.from(await res.Body!.transformToByteArray());
    },
    async delete(id) {
      await s3.send(new DeleteObjectCommand({ Bucket: o.bucket, Key: key(id) }));
    },
  };
}
