import { match } from 'path-to-regexp';
import { MethodNotAllowedException, NotFoundException } from '../responses';

type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

type Route<Path extends string, Env = unknown, CfHostMetadata = unknown> = {
	path: Path;
	method: HTTPMethod;
	handler: RouteHandler<Path, Env, CfHostMetadata>;
};

type ExtractRouteParams<T extends string> = T extends `${infer _Start}:${infer Param}/${infer Rest}`
	? { [K in Param | keyof ExtractRouteParams<`/${Rest}`>]: string }
	: T extends `${infer _Start}:${infer Param}`
	? { [K in Param]: string }
	: {};

type RouteHandler<Path extends string, Env = unknown, CfHostMetadata = unknown> = ({
	req,
	params,
	env,
	ctx,
}: {
	req: Request<CfHostMetadata, IncomingRequestCfProperties<CfHostMetadata>>;
	params: ExtractRouteParams<Path>;
	env: Env;
	ctx: ExecutionContext;
}) => Response | Promise<Response>;

export class Router<Env = unknown, CfHostMetadata = unknown> {
	routes: Route<string, Env, CfHostMetadata>[] = [];

	private sanitizePath(path: string): string {
		return path
			.replace(/^\/?/, '/') // Ensure starts with /
			.replace(/\/+$/, '') // Remove / from the end
			.replace(/\/{2,}/g, '/'); // Replace double // with /
	}

	private addRoute<Path extends string>(path: Path, method: HTTPMethod, handler: RouteHandler<Path, Env, CfHostMetadata>) {
		this.routes.push({ path: this.sanitizePath(path), method, handler });
	}

	public get<Path extends string>(path: Path, handler: RouteHandler<Path, Env>) {
		this.addRoute(path, 'GET', handler);
	}

	public post<Path extends string>(path: Path, handler: RouteHandler<Path, Env>) {
		this.addRoute(path, 'POST', handler);
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

		return await route.handler({
			req,
			params,
			env,
			ctx,
		});
	};
}
