import fetchProgress from "fetch-progress"
import { StrategyHandler } from 'workbox-strategies/StrategyHandler'
//@ts-ignore
// import {createReader, ZipReader, BlobReader} from "@zip.js/zip.js/dist/zip.js";
import { ZipReader, BlobReader, BlobWriter, configure } from '@zip.js/zip.js'

configure({
    useWebWorkers: false
})

type CacheResourceType = 'dynamicConvert' | 'staticConvert'

const contentTypesByExtension = {
    "css": "text/css",
    "js": "application/javascript",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "html": "text/html",
    "htm": "text/html"
}
const cacheStorageKey = 'netless'
// cdn link 可能会变
const resourcesHost = "convertcdn.netless.link";
export class AgoraCaches {
    private agoraCaches: Promise<Cache> | null = null;
    public openCache = (cachesName: string): Promise<Cache> => {
        if (!this.agoraCaches) {
            this.agoraCaches = caches.open(cachesName);
        }
        return this.agoraCaches;
    }

    public deleteCache = async () => {
        const result = await caches.delete(cacheStorageKey);
        console.log(`remove agora cache successfully: ${result}`);
        this.agoraCaches = null;
    }

    /**
     * 计算 cache 占用空间，大小单位为 Byte，/1024 为 KiB 大小。
     */
    public calculateCache = async (): Promise<number> => {
        const cache = await agoraCaches.openCache(cacheStorageKey);
        const keys = await cache.keys();
        let size = 0;
        for (const request of keys) {
            const response = await cache.match(request)!;
            if (response) {
                size += await (await response.blob()).size
            }
        }
        return size / (1024 * 1024);
    }

    public deleteTaskUUID = async (uuid: string) =>  {
        const cache = await this.openCache(cacheStorageKey);
        const keys = await cache.keys();
        for (const request of keys) {
            if (request.url.indexOf(uuid) !== -1) {
                await cache.delete(request);
            }
        }
    }

    public clearAllCache = async () => {
        const cache = await this.openCache(cacheStorageKey)
        const keys = await cache.keys()
        keys.forEach((key) => {
            cache.delete(key)
        }) 
    }

    public hasTaskUUID = async (uuid: string): Promise<boolean> =>  {
      const cache = await this.openCache(cacheStorageKey);
      const keys = await cache.keys();
      for (const request of keys) {
        if (request.url.indexOf(uuid) !== -1) {
          return true;
        }
      }
      return false;
    }

    public startDownload = async (taskUuid: string, onProgress?: (progress: number, controller: AbortController) => void): Promise<void> => {
        const channel = new BroadcastChannel('onFetchProgress')
        channel.onmessage = ({data}: any) => {
          if (data.url.match(taskUuid)) {
            if (onProgress) {
                console.log('data', data.progress)
                onProgress(data.progress, controller);
            }
          }
        }
        const controller = new AbortController();
        const signal = controller.signal;
        const zipUrl = `https://${resourcesHost}/dynamicConvert/${taskUuid}.zip`;
        const res = await fetch(zipUrl, {
            method: "get",
            signal: signal,
        }).then(fetchProgress({
            // onProgress(progress: any) {
            //     if (onProgress) {
            //         onProgress(progress.percentage, controller);
            //     }
            // },
        }));
        if (res.status !== 200) {
            throw new Error(`download task ${JSON.stringify(taskUuid)} failed with status ${res.status}`);
        }
        // const buffer = await res.arrayBuffer();
        // const zipReader = await this.getZipReader(buffer);
        // return await this.cacheResources(zipReader);
    }

    async handleZipFile(response: Response) {
        const blob = await response.blob()
        const zipReader = await this.getZipReader(blob);
        const entry = await zipReader.getEntries()
        const cacheType = response.url.match(/dynamic/i) ? 'dynamicConvert' : 'staticConvert';
        return await this.cacheResources(entry, cacheType);
    }

    private createZipReader = (fileBlob: Blob): ZipReader => {
        return new ZipReader(new BlobReader(fileBlob))
    }

    public getZipReader = (file: Blob): Promise<ZipReader> => {
        return new Promise((resolve: any, reject: any) => {
            return resolve(this.createZipReader(file))
        });
    }

    public getContentType = (filename: any): string => {
        const tokens = filename.split(".");
        const extension = tokens[tokens.length - 1];
        return contentTypesByExtension[extension] || "text/plain";
    }


    public getLocation = (filename?: string, type?: CacheResourceType): string => {
        if (filename) {
            return `https://${resourcesHost}/${type}/${filename}`
        }
        return `https://${resourcesHost}/dynamicConvert/${filename}`;
    }

    public cacheEntry = async (entry: any, type: CacheResourceType): Promise<void> => {
        if (entry.directory) {
            return Promise.resolve();
        }
        const data = await entry.getData(new BlobWriter())
        const cache = await agoraCaches.openCache(cacheStorageKey)
        const location = this.getLocation(entry.filename, type)
        const response = new Response(data, {
            headers: {
                "Content-Type": this.getContentType(entry.filename)
            }
        });
        if (entry.filename === "index.html") {
            cache.put(this.getLocation(), response.clone());
        }
        return cache.put(location, response);
    }

    public availableSpace = async (): Promise<number> => {
        if (navigator.storage && navigator.storage.estimate) {
            const quota = await navigator.storage.estimate();
            if (quota.usage) {
                return quota.usage/ (1024 * 1024);
            } else {
                return 0;
            }
        } else {
            return 0;
        }
    }

    public cacheResources = (entries: any, type: CacheResourceType): Promise<void> => {
        return new Promise((fulfill, reject) => {
            // reader.getEntries((entries: any) => {
                Promise.all(entries.map((data: any) => this.cacheEntry(data, type))).then(fulfill as any, reject);
            // });
        });
    }
}

export type ProgressData = {
    progress: number,
    url: string,
}

export const agoraCaches = new AgoraCaches();
