import { FeatureFlags } from '../../src/types/feature-flags';
import { OkResponse, response } from '../OkResponse';

interface Env {
  confluence_plugin_features: KVNamespace;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method === 'GET') {
    try {
      const flags = await env.confluence_plugin_features.get('feature_flags');
      if (!flags) {
        // Initialize with default flags if none exist
        const defaultFlags: FeatureFlags = {
          metadata: {
            version: '1.0.0',
            lastUpdated: new Date().toISOString()
          },
          flags: {
            'diagram-like': {
              name: 'diagram-like',
              description: 'Allow users to like diagrams',
              enabled: true,
              rules: {
                domains: {
                  include: ['whimet4', 'zenuml-stg', 'dyon', 'danshuitaihejie', 'diagramly'],
                  exclude: []
                },
                default: false
              }
            }
          }
        };
        await env.confluence_plugin_features.put('feature_flags', JSON.stringify(defaultFlags));
        return new Response(JSON.stringify(defaultFlags), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(flags, {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Error fetching feature flags:', error);
      return response(500, 'Internal Server Error');
    }
  }

  return response(405, 'Method Not Allowed');
}; 