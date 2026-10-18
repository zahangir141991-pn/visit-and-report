import copy
import datetime
import importlib.util
import sqlite3
import unittest
from pathlib import Path
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location('connector', Path(__file__).parents[1]/'server'/'local-connector.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Ref:
    def __init__(self,data,path=''):
        self.data,self.path=data,path
    def child(self,path):
        return Ref(self.data,('/'.join([self.path,path])).strip('/'))
    def get(self):
        value=self.data
        for key in self.path.split('/'):
            if key:value=value.get(key,{})
        return copy.deepcopy(value)
    def setpath(self,path,value):
        keys=path.strip('/').split('/');target=self.data
        for key in keys[:-1]:target=target.setdefault(key,{})
        if value is None:target.pop(keys[-1],None)
        else:target[keys[-1]]=copy.deepcopy(value)
    def update(self,value):
        for path,item in value.items():self.setpath(('/'.join([self.path,path])).strip('/'),item)
    def transaction(self,change):
        value=change(self.get());self.setpath(self.path,value);return value

class Machine:
    def __init__(self):
        self.users=[SimpleNamespace(uid=1,user_id='101',name='Old',privilege=14,password='private-existing',group_id='g',card=999)]
        self.punches=[SimpleNamespace(user_id='101',timestamp=datetime.datetime(2026,10,18,8,30),punch=0)]
        self.sent=None
    def get_users(self):return self.users
    def get_serialnumber(self):return 'SN1'
    def get_attendance(self):return self.punches
    def set_user(self,**kwargs):
        self.sent=kwargs
        self.users=[SimpleNamespace(uid=kwargs['uid'],user_id=kwargs['user_id'],name=kwargs['name'],privilege=kwargs['privilege'],password=kwargs['password'],group_id=kwargs['group_id'],card=kwargs['card'])]

class ConnectorTests(unittest.TestCase):
    def test_user_update_preserves_credentials_and_privileges(self):
        machine=Machine();module.push_user(machine,{'code':'101','name':'New Name'},{'code':'101','name':'New Name'})
        self.assertEqual(machine.sent['privilege'],14);self.assertEqual(machine.sent['password'],'private-existing');self.assertEqual(machine.sent['card'],999)
    def test_rejects_changed_mapping(self):
        with self.assertRaises(ValueError):module.push_user(Machine(),{'code':'102'},{'code':'101','name':'A'})
    def test_cycle_saves_punches_and_only_confirms_user_after_readback(self):
        records={'d1':{'kind':'device','accessType':'Device','serial':'SN1','active':True},'e1':{'kind':'employee','code':'101','name':'New Name'},'j1':{'kind':'pushjob','device':'d1','employee':'e1','code':'101','name':'New Name','status':'Queued'}}
        root=Ref({'attendance':{'records':copy.deepcopy(records)}});checkpoint=sqlite3.connect(':memory:');checkpoint.execute('CREATE TABLE saved (id TEXT PRIMARY KEY)');machine=Machine();module.run_cycle(machine,root,'d1',records,checkpoint)
        saved=root.data['attendance']['records'];self.assertEqual(saved['j1']['status'],'Synced');self.assertEqual(saved['status_d1']['protocolVersion'],2);self.assertEqual(len([v for v in saved.values() if v.get('kind')=='punch']),1)
        module.run_cycle(machine,root,'d1',copy.deepcopy(saved),checkpoint);self.assertEqual(len([v for v in saved.values() if v.get('kind')=='punch']),1);checkpoint.close()
    def test_serial_mismatch_is_not_reported_online(self):
        root=Ref({});checkpoint=sqlite3.connect(':memory:');checkpoint.execute('CREATE TABLE saved (id TEXT PRIMARY KEY)')
        with self.assertRaises(ValueError):module.run_cycle(Machine(),root,'d1',{'d1':{'kind':'device','accessType':'Device','serial':'OTHER'}},checkpoint)
        self.assertEqual(root.data,{});checkpoint.close()

if __name__=='__main__':unittest.main()
