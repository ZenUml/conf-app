import * as jwt from '../lib/atlassian-jwt';
import { SymmetricAlgorithm } from '../lib/atlassian-jwt';

export function decode(token: string, secret: string) {
	const decoded = jwt.decodeSymmetric(token, secret, SymmetricAlgorithm.HS256);
	return decoded;
}