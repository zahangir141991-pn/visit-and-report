# Local emulator ONLY. Never uses production credentials or a production namespace.
import urllib.request, urllib.error, json, base64, time
from pathlib import Path
base='http://127.0.0.1:19005/'
ns='demo-dms-rules'
def req(path,method='GET',value=None,token=None,extra_headers=None):
 url=base+path+('.json' if not path.endswith('.json') else '')+'?ns='+ns
 headers={'Content-Type':'application/json',**(extra_headers or {})}
 if token=='owner':headers['Authorization']='Bearer owner'
 elif token:url+='&auth='+token
 try:
  with urllib.request.urlopen(urllib.request.Request(url,data=None if value is None else json.dumps(value).encode(),method=method,headers=headers),timeout=10) as x:return x.status,x.read().decode()
 except urllib.error.HTTPError as e:return e.code,e.read().decode()
def jwt(user,change=False,attendance=False,version=0):
 b=lambda v:base64.urlsafe_b64encode(json.dumps(v).encode()).decode().rstrip('=')
 claims={'iss':'https://securetoken.google.com/'+ns,'aud':ns,'auth_time':int(time.time()),'user_id':'dms_'+user,'sub':'dms_'+user,'iat':int(time.time()),'exp':int(time.time())+3600,'firebase':{'sign_in_provider':'custom'},'dmsUserId':user,'attendanceAdmin':user in ['admin','zahangir'] and not change,'dmsCredentialVersion':version,'dmsWallets':{user[-3:]:True}if user.startswith('01332517')else {'801':True}if user=='rubel'else {}}
 if not attendance:claims.update(dmsAuthenticated=True,dmsPasswordChangeRequired=change)
 return b({'alg':'none','typ':'JWT'})+'.'+b(claims)+'.'
def check(label,path,method='GET',value=None,user=None,want=401,token=None):
 code,body=req(path,method,value,token or (jwt(user)if user else None));assert code==want,(label,code,body);print('PASS',label)
rules=json.loads((Path(__file__).resolve().parents[1]/'server/DMS_DATABASE_RULES.json').read_text())
code,body=req('.settings/rules','PUT',rules,'owner');assert code==200,body
seed={'user_auth':{u:{'enabled':True}for u in ['admin','zahangir','rubel','01332517801','01332517802']},'dms_app_release':{'version':'test'},'visit_reports':{'old':{'user':'01332517801','dsoWallet':'801','uddoktaNumber':'01700000001','date':'2026-11-12'}},'new_uddokta_kyc':{'legacy':{'submittedBy':'01332517801','dsoWallet':'801','status':'Collected'}},'uddokta_master':{'a':{'dsoWallet':'801'}},'attendance':{'records':{'a':{'kind':'employee'}}}}
seed['user_auth'].update({'01332517'+str(n):{'enabled':True}for n in range(801,847)})
assert req('','PUT',seed,'owner')[0]==200
for path in ['visit_reports','uddokta_master','new_uddokta_kyc','user_auth','attendance_server','unknown_section']:
 check('anonymous denied '+path,path)
 check('DSO direct read denied '+path,path,user='01332517801')
check('public release','dms_app_release',want=200)
for user in ['admin','zahangir']:
 check('manager visits read '+user,'visit_reports',user=user,want=200)
 check('credential read denied '+user,'user_auth',user=user)
for user in ['zahangir','rubel','01332517801']:
 check('master overwrite denied '+user,'uddokta_master','PUT',{'evil':{}},user)
check('admin master upload','uddokta_master','PUT',{'a':{'dsoWallet':'801'}},'admin',200)
for user in ['admin','zahangir','01332517801']:
 check('visit deletion denied '+user,'visit_reports/old','DELETE',user=user)
 check('KYC deletion denied '+user,'new_uddokta_kyc/legacy','DELETE',user=user)
 check('root deletion denied '+user,'','DELETE',user=user)
check('spoofed login history','user_login_history/2026-11-12/x','PUT',{'userId':'admin'},'01332517801')
check('foreign sessions read denied','user_login_sessions/01332517802',user='01332517801')
visit={'user':'01332517801','dsoWallet':'801','uddoktaNumber':'01700000001','date':'2026-11-12'}
check('own visit creation','visit_reports/new','PUT',visit,'01332517801',200)
check('visit foreign wallet denied','visit_reports/spoof','PUT',{**visit,'dsoWallet':'802'},'01332517801')
check('visit owner spoof denied','visit_reports/spoof','PUT',{**visit,'user':'01332517802'},'01332517801')
k={'id':'k','submittedBy':'01332517801','dsoWallet':'801','uddoktaNumber':'01700000001','status':'Collected','submissionState':'pending','submissionToken':'random-test-token','createdAt':1,'hasPhoto':False}
check('KYC pending claim','new_uddokta_kyc/k','PUT',k,'01332517801',200)
check('KYC foreign wallet denied','new_uddokta_kyc/foreign','PUT',{**k,'id':'foreign','dsoWallet':'802'},'01332517801')
check('KYC atomic completion','','PATCH',{'new_uddokta_kyc/k':{**k,'hasPhoto':True,'submissionState':'complete'},'new_uddokta_kyc_photos/k':'data:image/jpeg;base64,TEST'},'01332517801',200)
check('DSO cannot change KYC status','new_uddokta_kyc/k/status','PUT','Active','01332517801')
check('admin status with history','new_uddokta_kyc/k','PATCH',{'status':'Active','statusHistory/event1':{'status':'Active','at':'now','by':'admin','timestamp':2}},'admin',200)
check('history removal denied','new_uddokta_kyc/k/statusHistory/event1','DELETE',user='admin')
check('history overwrite denied','new_uddokta_kyc/k/statusHistory/event1','PUT',{'status':'Rejection','at':'later','by':'admin','timestamp':3},'admin')
check('legacy KYC status update preserved','new_uddokta_kyc/legacy/status','PUT','Active','admin',200)
check('forced password token denied','visit_reports',token=jwt('admin',change=True))
check('attendance-only token cannot read visits','visit_reports',token=jwt('admin',attendance=True))
check('attendance-only token reads attendance','attendance/records',token=jwt('admin',attendance=True),want=200)
# Exercise the real client protocol: conditional claim, Firebase-resolved clock,
# separate atomic photo completion, and retries for all 46 DSO wallets.
for wallet in range(801,847):
 user='01332517'+str(wallet);rid='clock_'+str(wallet)
 pending={**k,'id':rid,'submittedBy':user,'dsoWallet':str(wallet),'createdAt':{'.sv':'timestamp'}}
 code,body=req('new_uddokta_kyc/'+rid,'PUT',pending,jwt(user),{'If-Match':'null_etag'})
 assert code==200,('conditional claim',wallet,code,body)
 claimed=json.loads(body);assert isinstance(claimed.get('createdAt'),(int,float)),('unresolved clock',wallet)
 if wallet==817:
  # The old client sent the unresolved timestamp placeholder again. That changes
  # the immutable creation time at completion and must be rejected by the rules.
  time.sleep(.01)
  bad={**pending,'hasPhoto':True,'submissionState':'complete'}
  code,body=req('','PATCH',{'new_uddokta_kyc/'+rid:bad,'new_uddokta_kyc_photos/'+rid:'photo'},jwt(user))
  assert code==401,('immutable creation time regression',code,body)
 complete={**claimed,'hasPhoto':True,'submissionState':'complete','updatedAt':{'.sv':'timestamp'}}
 code,body=req('','PATCH',{'new_uddokta_kyc/'+rid:complete,'new_uddokta_kyc_photos/'+rid:'data:image/jpeg;base64,TEST'},jwt(user))
 assert code==200,('atomic completion with real timestamp',wallet,code,body)
 print('PASS conditional KYC claim and real-clock completion DSO',wallet)
check('disabled account setup','user_auth/01332517801/disabled','PUT',True,token='owner',want=200)
check('disabled account write denied','visit_reports/disabled','PUT',visit,'01332517801')
check('reset account setup','user_auth/admin/updatedAt','PUT',42,token='owner',want=200)
check('pre-reset token denied','visit_reports',user='admin')
check('new credential token allowed','visit_reports',token=jwt('admin',version=42),want=200)
print('All emulator security checks passed')
