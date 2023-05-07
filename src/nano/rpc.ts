import { BlockRepresentation, checkAddress, createBlock, derivePublicKey, validateWork } from "nanocurrency";

interface RPCProps {
    rpcURLs: string | string[];
    workerURLs: string | string[];
    representative: string;
    timeout?: number;
}

interface ReceiveData {
    link: string;
    amount: string;
    previous?: string;
}

interface SendData {
    link: string;
    previous: string;
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

const SEND_DIFFICULTY = 'fffffff800000000';
const RECEIVE_DIFFICULTY = 'fffffe0000000000';

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

export default class RPC {
    rpcURLs: string[];
    workerURLs: string[];
    representative: string;
    timeout: number;

    constructor({
        rpcURLs,
        workerURLs,
        representative,
        timeout = 30000
    }: RPCProps) {
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
        this.representative = representative;
        if (!checkAddress(this.representative)) {
            throw new Error(`Invalid representative address: ${representative}`);
        }
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

    async receive(secretKey: string, data: ReceiveData) {

        const previous = data.previous || null
        const balance = data.amount

        const { block, hash } = createBlock(secretKey, {
            previous,
            representative: this.representative,
            balance,
            link: data.link,
            work: null
        })

        const frontier = previous || derivePublicKey(secretKey);

        const { work } = await this.workGenerate(frontier, RECEIVE_DIFFICULTY);

        if (!work) {
            throw new Error('No work');
        }

        const isValidWork = validateWork({
            work,
            blockHash: frontier,
            threshold: RECEIVE_DIFFICULTY
        });

        if (!isValidWork) {
            throw new Error('Invalid work');
        }

        const processed = await this.process({
            ...block,
            work
        });

        if (processed.hash !== hash) {
            throw new Error('Block hash mismatch');
        }

        return { hash };
    }

    async sendAll(secretKey: string, data: SendData) {
        const { block, hash } = createBlock(secretKey, {
            previous: data.previous,
            representative: this.representative,
            balance: '0',
            link: data.link,
            work: null
        })

        const frontier = data.previous;

        const { work } = await this.workGenerate(frontier, SEND_DIFFICULTY);

        if (!work) {
            throw new Error('No work');
        }

        const isValidWork = validateWork({
            work,
            blockHash: frontier,
            threshold: SEND_DIFFICULTY
        });

        if (!isValidWork) {
            throw new Error('Invalid work');
        }

        const processed = await this.process({
            ...block,
            work
        });

        if (processed.hash !== hash) {
            throw new Error('Block hash mismatch');
        }

        return { hash };
    }

}