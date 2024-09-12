export type LogLevel = 'info' | 'warning' | 'error' | 'debug';

export type Log = {
	message: string;
	error?: string;
	level: LogLevel;
	[key: string]: unknown;
};

export type LoggerArgs = {
	isLocalDev?: boolean;
};

export class Logger {
	private readonly logs: Log[] = [];
	private isLocalDev: boolean;

	constructor(args: LoggerArgs) {
		this.isLocalDev = args.isLocalDev || false;
	}

	private async _log(message: string, level: LogLevel, data?: Record<string, unknown>) {
		if (this.isLocalDev) {
			const colors: Record<LogLevel, string> = {
				info: '\x1b[32m',
				warning: '\x1b[33m',
				error: '\x1b[31m',
				debug: '\x1b[35m',
			};

			const grey = '\x1b[90m';
			const white = '\x1b[0m';
			console.log(`${colors[level]}${level.toUpperCase()}${grey} | ${white}${message}`);
			if (data) {
				console.log(`${grey} ${JSON.stringify(data, null, 2)}`);
			}
			return;
		}

		const log: Log = {
			message,
			level,
			timestamp: Date.now(),
			...data,
		};
		console.log(JSON.stringify(log, null, 2));
	}

	log(msg: string, data?: Record<string, unknown>) {
		this._log(msg, 'info', data);
	}

	info(msg: string, data?: Record<string, unknown>) {
		this._log(msg, 'info', data);
	}

	warn(msg: string, data?: Record<string, unknown>) {
		this._log(msg, 'warning', data);
	}

	error(msg: string | Error | unknown, data?: Record<string, unknown>) {
		let m = '';
		if (msg instanceof Error) {
			m = msg.message + (msg.stack ? `: ${msg.stack}` : '');
		} else if (typeof msg === 'string') {
			m = msg;
		} else {
			m = JSON.stringify(msg);
		}
		this._log(m, 'error', data);
	}

	debug(msg: string, data?: Record<string, unknown>) {
		if (this.isLocalDev) {
			this._log(msg, 'debug', data);
		}
	}

	setLocalDev(isLocalDev: boolean) {
		this.isLocalDev = isLocalDev;
	}
}

export const logger = new Logger({ isLocalDev: false });
