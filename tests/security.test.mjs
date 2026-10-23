import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('private cache requires login and clears between sessions',()=>{
 const fragment=source.slice(source.indexOf('const privateDataStorage='),source.indexOf('function purgePersistentPrivateData'));
 const context=vm.createContext({});
 vm.runInContext('let currentUser=null;'+fragment+'globalThis.cache=privateDataStorage;',context);
 context.cache.setItem('report','secret');assert.equal(context.cache.getItem('report'),null);
 vm.runInContext("currentUser='admin'",context);assert.equal(context.cache.getItem('report'),null);
 context.cache.setItem('report','secret');assert.equal(context.cache.getItem('report'),'secret');
 context.cache.clear();vm.runInContext('currentUser=null',context);assert.equal(context.cache.getItem('report'),null);
});
test('old private disk caches purged without deleting device or retry tokens',()=>{
 const removed=[];const start=source.indexOf('function purgePersistentPrivateData()');
 const fragment=source.slice(start,source.indexOf('purgePersistentPrivateData();',start));
 const context=vm.createContext({localStorage:{removeItem:key=>removed.push(key)},UDDOKTA_CACHE_KEY:'master',UDDOKTA_CACHE_META_KEY:'meta',UDDOKTA_MASTER_META_KEY:'authority',REPORTS_CACHE_KEY:'reports'});
 vm.runInContext(fragment+'purgePersistentPrivateData();',context);
 assert.equal(removed.length,8);assert.ok(removed.includes('dm_app_passwords'));assert.ok(!removed.some(x=>/attempt|device/i.test(x)));
});
test('public HTML has no embedded master payload or local password fallback',()=>{
 assert.ok(!source.includes('EMBEDDED_MASTER_GZIP_BASE64'));
 assert.ok(!source.includes("localStorage.setItem('dm_app_passwords'"));
 const login=source.slice(source.indexOf('let cloudAuth;',source.indexOf('async function login(')),source.indexOf('userPasswords[user]=pass;'));
 assert.match(login,/await signInDmsServer\(user,pass\)/);assert.ok(!source.includes('async function readCloudAuth('));
 assert.ok(!login.includes('saveCloudAuth'));assert.ok(!login.includes('userPasswords['));
});
test('inline scripts parse',()=>{for(const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)){if(match[1].trim())new vm.Script(match[1]);}});
