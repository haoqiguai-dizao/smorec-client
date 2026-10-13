import config from '../config/distribution.json';
import type { UpdateConfiguration } from '../shared/update-types';
import { applyMacUpdate, recoverMacUpdate, stageMacUpdate } from './services/updates/mac/apply';

process.noAsar = true;
const [command, plan] = process.argv.slice(2);
if (process.platform !== 'darwin' || !plan || process.argv.length !== 4) throw new Error('Mac 更新助手参数无效');
const configuration = config as UpdateConfiguration;
const operation = command === 'stage' ? stageMacUpdate(plan, configuration).then(() => 'staged')
  : command === 'apply' ? applyMacUpdate(plan, configuration).then(() => 'confirmed')
    : command === 'recover' ? recoverMacUpdate(plan, configuration) : Promise.reject(new Error('未知更新操作'));
operation.then(result => console.log(result)).catch(error => { console.error(error); process.exitCode = 1; });
