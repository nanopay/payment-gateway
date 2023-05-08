import { createBlock, deriveAddress, derivePublicKey, validateWork } from "nanocurrency";
import NanoRPC, { NanoRPCProps } from "./rpc";
import { RECEIVE_DIFFICULTY, SEND_DIFFICULTY } from "./constants";
import { TunedBigNumber } from "../utils";

export interface NanoWalletProps extends NanoRPCProps {
    privateKey: string;
    representative: string;
    kvStore: KVNamespace;
}

export interface NanoWalletState {
    balance: string;
    frontier: string | null;
}

export interface ReceiveData {
    link: string;
    amount: string;
    previous?: string | null;
}

export interface SendData {
    link: string;
    previous: string;
}

export default class NanoWallet {
    rpc: NanoRPC;
    private privateKey: string;
    private kvStore: KVNamespace;
    private publicKey: string;
    account: string;
    representative: string;
    state: NanoWalletState = {
        balance: '0',
        frontier: null,
    };

    constructor({
        privateKey,
        rpcURLs,
        workerURLs,
        timeout = 30000,
        representative,
        kvStore
    }: NanoWalletProps) {
        this.privateKey = privateKey;
        this.publicKey = derivePublicKey(this.privateKey);
        this.account = deriveAddress(this.publicKey);
        this.kvStore = kvStore;
        this.rpc = new NanoRPC({ rpcURLs, workerURLs, timeout });
        this.representative = representative;
    }

    async init () {
        const state = await this.kvStore.get(this.account);
        if (state) {
            this.state = JSON.parse(state);
        }
    }

    async update (state: Partial<NanoWalletState>) {
        this.state = {
            ...this.state,
            ...state
        };
        this.kvStore.put(this.account, JSON.stringify(this.state));
    }

    async workGenerate (hash: string, threshold: string) {
        const { work } = await this.rpc.workGenerate(hash, threshold);

        if (!work) {
            throw new Error('No work');
        }

        const isValidWork = validateWork({
            work,
            blockHash: hash,
            threshold
        });

        if (!isValidWork) {
            throw new Error('Invalid work');
        }

        return work;
    }

    async receive(data: ReceiveData) {

        const previous = data.previous || null
        const balance = TunedBigNumber(this.state.balance).plus(data.amount).toString();

        const { block, hash } = createBlock(this.privateKey, {
            previous,
            representative: this.representative,
            balance,
            link: data.link,
            work: null
        })

        const frontier = previous || this.publicKey;

        const work = await this.workGenerate(frontier, RECEIVE_DIFFICULTY);

        const processed = await this.rpc.process({
            ...block,
            work
        });

        if (processed.hash !== hash) {
            throw new Error('Block hash mismatch');
        }

        await this.update({
            balance,
            frontier: hash,
        });

        return { hash };
    }

    async sendAll(data: SendData) {
        const { block, hash } = createBlock(this.privateKey, {
            previous: data.previous,
            representative: this.representative,
            balance: '0',
            link: data.link,
            work: null
        })

        const work = await this.workGenerate(data.previous, SEND_DIFFICULTY);

        const processed = await this.rpc.process({
            ...block,
            work
        });

        if (processed.hash !== hash) {
            throw new Error('Block hash mismatch');
        }

        await this.update({
            balance: '0',
            frontier: hash,
        });

        return { hash };
    }

}