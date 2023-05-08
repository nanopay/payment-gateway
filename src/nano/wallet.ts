import { checkAddress, createBlock, derivePublicKey, validateWork } from "nanocurrency";
import NanoRPC, { NanoRPCProps } from "./rpc";
import { RECEIVE_DIFFICULTY, SEND_DIFFICULTY } from "./constants";

interface NanoWalletProps extends NanoRPCProps {
    representative: string;
}

interface ReceiveData {
    link: string;
    amount: string;
    previous?: string | null;
}

interface SendData {
    link: string;
    previous: string;
}

export default class NanoWallet {
    rpc: NanoRPC;
    representative: string;

    constructor({
        rpcURLs,
        workerURLs,
        timeout = 30000,
        representative,
    }: NanoWalletProps) {
        this.rpc = new NanoRPC({ rpcURLs, workerURLs, timeout });
        this.representative = representative;
        if (!checkAddress(this.representative)) {
            throw new Error(`Invalid representative address: ${representative}`);
        }
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

        const { work } = await this.rpc.workGenerate(frontier, RECEIVE_DIFFICULTY);

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

        const processed = await this.rpc.process({
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

        const { work } = await this.rpc.workGenerate(frontier, SEND_DIFFICULTY);

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

        const processed = await this.rpc.process({
            ...block,
            work
        });

        if (processed.hash !== hash) {
            throw new Error('Block hash mismatch');
        }

        return { hash };
    }

}