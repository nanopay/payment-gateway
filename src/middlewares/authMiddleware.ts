import { UnauthorizedException } from '../responses';
import { RouteHandler } from '../utils/router';

export const authMiddleware: RouteHandler<string, Env> = ({ req, env, next }) => {
	const authorizationHeader = req.headers.get('Authorization');
	const bearerToken = authorizationHeader?.split(' ')[1];
	const authorized = bearerToken === env.AUTH_TOKEN;
	if (!authorized) {
		return UnauthorizedException();
	}
	return next();
};
