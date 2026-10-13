import { session } from 'electron';
import { parseStreamProxies, streamProxyURL, StreamProxyError, type StreamProxyResolver } from './proxy-routing';

export const resolveSystemStreamProxy: StreamProxyResolver = async server => {
  let resolved: string, timer: ReturnType<typeof setTimeout> | undefined;
  try {
    resolved = await Promise.race([session.defaultSession.resolveProxy(streamProxyURL(server)),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new StreamProxyError('configuration')), 8000); })]);
  }
  catch { throw new StreamProxyError('configuration'); }
  finally { clearTimeout(timer); }
  return parseStreamProxies(resolved);
};
