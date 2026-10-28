# Requires a local Firebase Database emulator at 127.0.0.1:19005. Seeds only demo-dms-rules.
import urllib.request,urllib.error,json,base64,time
from pathlib import Path
base='http://127.0.0.1:19005/'
ns='demo-dms-rules'
def req(path,method='GET',value=None,token=None):
 url=base+path+('.json' if not path.endswith('.json') else '')+'?ns='+ns
 headers={'Content-Type':'application/json'}
 if token == 'owner':headers['Authorization']='Bearer owner'
 elif token:url+='&auth='+token
 r=urllib.request.Request(url,data=None if value is None else json.dumps(value).encode(),method=method,headers=headers)
 try:
  with urllib.request.urlopen(r,timeout=10) as x:return x.status,x.read().decode()
 except urllib.error.HTTPError as e:return e.code,e.read().decode()
def jwt(user,attendance=False,change=False):
 b=lambda v:base64.urlsafe_b64encode(json.dumps(v).encode()).decode().rstrip('=')
 claims={'iss':'https://securetoken.google.com/demo-dms-rules','aud':'demo-dms-rules','auth_time':int(time.time()),'user_id':'dms_'+user,'sub':'dms_'+user,'iat':int(time.time()),'exp':int(time.time())+3600,'firebase':{'sign_in_provider':'custom'},'dmsUserId':user,'attendanceAdmin':user in ['admin','zahangir'] and not change}
 if not attendance:claims.update(dmsAuthenticated=True,dmsPasswordChangeRequired=change)
 return b({'alg':'none','typ':'JWT'})+'.'+b(claims)+'.'
rules=json.load(open(Path(__file__).resolve().parents[1]/'server/DMS_DATABASE_RULES.json'));code,body=req('.settings/rules',method='PUT',value=rules,token='owner');print('RULE COMPILE',code,body[:100]);assert code==200
assert req('',method='PUT',value={'user_auth':{'secret':'private'},'visit_reports':{'r1':{'date':'2026-10-28'}},'monthly_performance':{'2026-09':{'groups':{'801':{'txn':123}}}},'dms_app_release':{'version':'test'},'attendance':{'records':{'test':{'kind':'device'}}}},token='owner')[0]==200
checks=[('anonymous visit denied',req('visit_reports')[0],401),('anonymous write denied',req('visit_reports/test','PUT',{},None)[0],401),('release public',req('dms_app_release')[0],200),('main user read',req('visit_reports',token=jwt('01332517801'))[0],200),('credential denied to admin',req('user_auth',token=jwt('admin'))[0],401),('admin monthly read',req('monthly_performance',token=jwt('admin'))[0],200),('DM monthly read',req('monthly_performance',token=jwt('zahangir'))[0],200),('DSO monthly denied',req('monthly_performance',token=jwt('01332517801'))[0],401),('DM monthly write denied',req('monthly_performance/2026-10','PUT',{},jwt('zahangir'))[0],401),('admin monthly write',req('monthly_performance/2026-10','PUT',{},jwt('admin'))[0],200),('password change required denied',req('visit_reports',token=jwt('admin',change=True))[0],401),('attendance-only token attendance works',req('attendance/records',token=jwt('zahangir',attendance=True))[0],200),('attendance-only token main denied',req('visit_reports',token=jwt('zahangir',attendance=True))[0],401),('attendance server client denied',req('attendance_server',token=jwt('admin'))[0],401)]
for label,got,want in checks:print(label,got,'PASS' if got==want else 'FAIL')
assert all(got==want for _,got,want in checks)

for user,expected in [('admin',200),('zahangir',401),('alamin',401),('01332517801',401)]:
 code,_=req('uddokta_master/test','PUT',{'dsoWallet':'801','dssName':'RUBEL'},jwt(user));print('master authority',user,code);assert code==expected
