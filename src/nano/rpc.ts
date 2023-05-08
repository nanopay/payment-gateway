import { BlockRepresentation, checkAddress, createBlock, derivePublicKey, validateWork } from "nanocurrency";

export interface NanoRPCProps {
    rpcURLs: string | string[];
    workerURLs: string | string[];
    timeout?: number;
}

interface WorkGenerateResponse {
    work: string;
    difficulty: string;
    multiplier: string;
    hash: string;
}

interface ProcessResponse {
    hash: string;
}

const postJsonWithTimeout = async <T>(url: string, body: any, timeout = 30000): Promise<T> => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            "content-type": "application/json;charset=UTF-8",
            "content-length": JSON.stringify(body).length.toString(),
        },
        body: JSON.stringify(body),
        signal: controller.signal
    });
    clearTimeout(id);
    return response.json();
}

export default class NanoRPC {
    rpcURLs: string[];
    workerURLs: string[];
    timeout: number;

    constructor({
        rpcURLs,
        workerURLs,
        timeout = 30000
    }: NanoRPCProps) {
        this.rpcURLs = rpcURLs instanceof Array ? rpcURLs : [rpcURLs];
        if (this.rpcURLs.length < 0) {
            throw new Error("No RPC addresses provided");
        }
        this.rpcURLs.forEach(addr => {
            try {
                new URL(addr);
            } catch (err) {
                throw new Error(`Invalid RPC address: ${addr}`);
            }
        })
        this.workerURLs = workerURLs instanceof Array ? workerURLs : [workerURLs];
        if (this.workerURLs.length < 0) {
            throw new Error("No workers addresses provided");
        }
        this.workerURLs.forEach(addr => {
            try {
                new URL(addr);
            } catch (err) {
                throw new Error(`Invalid workers address: ${addr}`);
            }
        })
        this.timeout = timeout;
    }

    async postRPC<TRPCResponse = unknown>(data: any, urls = this.rpcURLs, retry = 0): Promise<TRPCResponse> {
        const url = urls[retry];
        try {
            const response = await postJsonWithTimeout<TRPCResponse>(url, data, this.timeout);
            if (response instanceof Object && "error" in response) {
                throw new Error(`RPC error: ${response.error}`);
            }
            return response;
        } catch (e) {
            if (retry < urls.length - 1) {
                return await this.postRPC(data, urls, retry + 1);
            } else {
                throw e;
            }
        }
    }

    async process(block: BlockRepresentation) {
        const data = {
            action: "process",
            json_block: "true",
            block
        }
        return this.postRPC<ProcessResponse>(data);
    }

    async workGenerate(hash: string, difficulty: string) {
        const data = {
            action: "work_generate",
            hash,
            difficulty
        }
        return this.postRPC<WorkGenerateResponse>(data, this.workerURLs)
    }
}