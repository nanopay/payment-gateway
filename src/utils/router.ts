import { match } from 'path-to-regexp';
import { MethodNotAllowedException, NotFoundException, ServerException } from '../responses';

export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

export type Route<Path extends string, Env = unknown, CfHostMetadata = unknown> = {
	path: Path;
	method: HTTPMethod;
	handlers: RouteHandler<Path, Env, CfHostMetadata>[];
};

export type ExtractRouteParams<T extends string> = T extends `${infer _Start}:${infer Param}/${infer Rest}`
	? { [K in Param | keyof ExtractRouteParams<`/${Rest}`>]: string }
	: T extends `${infer _Start}:${infer Param}`
	? { [K in Param]: string }
	: {};

export type Next = () => Response | Promise<Response>;

export type RouteHandler<Path extends string, Env = unknown, CfHostMetadata = unknown> = ({
	req,
	params,
	env,
	ctx,
	next,
}: {
	req: Request<CfHostMetadata, IncomingRequestCfProperties<CfHostMetadata>>;
	params: ExtractRouteParams<Path>;
	env: Env;
	ctx: ExecutionContext;
	next: Next;
}) => Response | Promise<Response>;

export class Router<Env = unknown, CfHostMetadata = unknown> {
	routes: Route<string, Env, CfHostMetadata>[] = [];

	private sanitizePath(path: string): string {
		return path
			.replace(/^\/?/, '/') // Ensure starts with /
			.replace(/\/+$/, '') // Remove / from the end
			.replace(/\/{2,}/g, '/'); // Replace double // with /
	}

	private addRoute<Path extends string>(path: Path, method: HTTPMethod, ...handlers: RouteHandler<Path, Env, CfHostMetadata>[]) {
		this.routes.push({ path: this.sanitizePath(path), method, handlers });
	}

	public get<Path extends string, H extends RouteHandler<Path, Env>[]>(
		path: Path,
		...handlers: H & { [K in keyof H]: RouteHandler<Path, Env> }
	) {
		this.addRoute(path, 'GET', ...handlers);
	}

	public post<Path extends string, H extends RouteHandler<Path, Env>[]>(
		path: Path,
		...handlers: H & { [K in keyof H]: RouteHandler<Path, Env> }
	) {
		this.addRoute(path, 'POST', ...handlers);
	}

	public route(path: string, router: Router<Env, CfHostMetadata>): void {
		router.routes.forEach((route) => {
			this.addRoute(`${path}${this.sanitizePath(route.path)}`, route.method, ...route.handlers);
		});
	}

	public fetch: ExportedHandlerFetchHandler<Env, CfHostMetadata> = async (req, env, ctx) => {
		const { pathname } = new URL(req.url);

		let pathExists = false;
		let params: ExtractRouteParams<typeof pathname> = {};

		const route = this.routes.find((route) => {
			const result = match(route.path)(pathname);
			if (result) {
				pathExists = true;
				if (route.method === req.method) {
					params = result.params;
					return true;
				}
			}
		});

		if (!route) {
			return pathExists ? MethodNotAllowedException() : NotFoundException();
		}

		// Run handlers (middlewares and final handler) in sequence
		let index = 0;
		const next = async (): Promise<Response> => {
			if (index < route.handlers.length) {
				const handler = route.handlers[index++];
				return await handler({ req, params, env, ctx, next });
			}
			return ServerException('No response returned');
		};

		return await next();
	};
}
