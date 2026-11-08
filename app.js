import {firebaseConfig,ADMIN_UID} from './config.js';
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth,onAuthStateChanged,signInWithEmailAndPassword,signInAnonymously,signOut} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {getFirestore,doc,collection,query,where,onSnapshot,getDoc,setDoc,updateDoc,runTransaction,serverTimestamp,writeBatch,getDocs} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
const $=id=>document.getElementById(id),fields=['경지','인력','노경','안전','환경','WCD'],levels=['하','중','상'],points=[50,100,150],gid='main';
const qid=(f,l)=>`${f}-${l}`,counts=()=>Array.from({length:6},(_,i)=>Math.max(1,Math.min(10,Number(game.questionCounts?.[i])||3))),totalQuestions=()=>activeQuestions().length,activeQuestions=()=>questions.filter(q=>{const f=fields.indexOf(q.field);return f>=0&&Number(q.id.split('-')[1])<counts()[f]&&q.level!=='없음'}),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db,auth,user=null,admin=false,game={},teams=[],questions=[],answers=[],unsubs=[],clockTimer=null,closing=false,finalizing=false,submitting=false,gradingDraft={},gradingId='',loaded={game:false,teams:false,questions:false,answers:false};
const ref=(...p)=>doc(db,...p),visible=(id,yes)=>$(id)?.classList.toggle('hidden',!yes),text=(id,v)=>{if($(id))$(id).textContent=v},notice=s=>text('notice',s),error=e=>{console.error(e);notice('오류: '+(e?.message||e))};
const sortedTeams=()=>[...teams].sort((a,b)=>(Number(a.id.replace('team',''))||0)-(Number(b.id.replace('team',''))||0));
const currentQ=()=>questions.find(q=>q.id===game.current),myTeam=()=>teams.find(t=>t.uid===user?.uid),answerFor=id=>answers.find(a=>a.id===`${game.current}_${id}`),autoPercent=(a,q)=>a?.text&&q?.correct&&String(a.text).trim()===String(q.correct).trim()?100:0;
const qType=q=>['choice','order'].includes(q?.type)?q.type:'text';
const answerLabel=(value,q)=>qType(q)==='text'?String(value||''):qType(q)==='choice'?`${value}번 · ${q.options?.[Number(value)-1]||''}`:String(value||'').split(',').map(v=>`${v}번 ${q.options?.[Number(v)-1]||''}`).join(' → ');
let orderSelection=[];
function resetAnswerUi(){orderSelection=[];const el=$('answerInput');if(el)el.value='';text('submitMsg','')}
function renderAnswerUi(q){const type=qType(q),area=$('structuredAnswer');if(!area)return;visible('answerInput',type==='text');visible('answerInputLabel',type==='text');visible('structuredAnswer',type!=='text');if(type==='text')return;const existing=answerFor(myTeam()?.id);if(existing){area.innerHTML=`<p class="muted">제출한 답안: ${esc(answerLabel(existing.text,q))}</p>`;return}const opts=q.options||[];if(type==='choice'){area.innerHTML='<p class="muted">정답 하나를 선택하세요.</p>'+opts.map((v,i)=>`<label class="quiz-option"><input type="radio" name="quizChoice" value="${i+1}"> <b>${i+1}.</b> ${esc(v)}</label>`).join('');return}area.innerHTML='<p class="muted">정답 순서대로 4개 항목을 터치하세요.</p><div class="order-options">'+opts.map((v,i)=>`<button type="button" class="order-option" data-order="${i+1}">${i+1}. ${esc(v)}</button>`).join('')+'</div><p id="orderSelected" class="order-result"></p><button type="button" id="orderClear" class="secondary">다시 선택</button>';area.querySelectorAll('[data-order]').forEach(b=>b.onclick=()=>{const n=b.dataset.order;if(!orderSelection.includes(n)&&orderSelection.length<4)orderSelection.push(n);updateOrderUi()});$('orderClear').onclick=()=>{orderSelection=[];updateOrderUi()};updateOrderUi()}
function updateOrderUi(){const el=$('structuredAnswer');if(!el)return;el.querySelectorAll('[data-order]').forEach(b=>{const i=orderSelection.indexOf(b.dataset.order);b.disabled=i!==-1;b.classList.toggle('picked',i!==-1)});const out=$('orderSelected');if(out)out.textContent='선택한 순서: '+(orderSelection.join(' → ')||'없음')}

const defaultTimes={하:30,중:60,상:90};
function durationFor(q){const v=Number(game?.timeLimits?.[q?.level]);return Number.isInteger(v)&&v>=5&&v<=600?v:defaultTimes[q?.level]||60}
function syncTimeInputs(){if(!admin)return;[['timeLow','하'],['timeMid','중'],['timeHigh','상']].forEach(([id,l])=>{const el=$(id);if(el&&document.activeElement!==el)el.value=durationFor({level:l})})}
function remaining(){if(game.phase!=='running'||game.paused)return game.remaining??60;const end=game.deadline?.toMillis?.();return end?Math.max(0,Math.ceil((end-Date.now())/1000)):game.remaining??60}
if(!firebaseConfig?.projectId||!ADMIN_UID){visible('setup',true);notice('Firebase 설정을 확인하세요.')}else{try{const app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);onAuthStateChanged(auth,handleAuth)}catch(e){error(e)}}
$('loginBtn').onclick=async()=>{try{await signInWithEmailAndPassword(auth,$('email').value.trim(),$('password').value)}catch(e){error(e)}};
$('logout').onclick=async()=>{await signOut(auth);location.href=location.pathname+'?admin=1'};
$('adminLoginShow').onclick=()=>{visible('joinPanel',false);visible('login',true)};
const joinUrl=location.origin+location.pathname+'?join=1';
let joinBusy=false;
$('joinBtn').onclick=async()=>{
 if(joinBusy)return;
 const name=$('joinName').value.trim().replace(/\s+/g,' ');
 if(name.length<2||name.length>24){text('joinError','팀 이름은 2~24자로 입력하세요.');return}
 joinBusy=true;$('joinBtn').disabled=true;text('joinError','팀 등록 중입니다...');
 try{
  if(!auth.currentUser)await signInAnonymously(auth);
  if(!auth.currentUser.isAnonymous)throw Error('관리자 계정에서는 팀 참가가 불가능합니다.');
  const uid=auth.currentUser.uid;
  const key=Array.from(new TextEncoder().encode(name.normalize('NFKC').toLocaleLowerCase('ko'))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const teamRefs=Array.from({length:9},(_,i)=>ref('games',gid,'teams',`team${i+1}`));
  const nr=ref('games',gid,'teamNames',key);
  await runTransaction(db,async tx=>{
    const teamSnaps=await Promise.all(teamRefs.map(r=>tx.get(r)));
    const nameSnap=await tx.get(nr);
    if(teamSnaps.some(s=>s.data()?.uid===uid))return;
    if(nameSnap.exists())throw Error('이미 사용 중인 팀 이름입니다. 다른 이름을 입력하세요.');
    const idx=teamSnaps.findIndex(s=>s.exists()&&!s.data()?.uid);
    if(idx<0)throw Error('9개 팀 등록이 모두 완료되었습니다.');
    const tid=`team${idx+1}`;
    tx.update(teamRefs[idx],{name,uid,nameKey:key});
    tx.set(nr,{name,uid,teamId:tid});
  });
  text('joinError','팀 등록이 완료되었습니다.');
 }catch(e){console.error(e);text('joinError','등록 실패: '+(e?.message||e))}
 finally{joinBusy=false;$('joinBtn').disabled=false}
};
function showJoinQr(){const target=$('qrCode');if(!target)return;text('joinLink',joinUrl);target.innerHTML='';if(window.QRCode)new window.QRCode(target,{text:joinUrl,width:260,height:260,correctLevel:window.QRCode.CorrectLevel.M});else target.textContent='QR코드 로딩 실패 — 아래 주소를 공유하세요.';}
showJoinQr();
async function initializeGame(){const gr=ref('games',gid);if(!(await getDoc(gr)).exists())await setDoc(gr,{phase:'board',current:'',deadline:null,remaining:60,paused:false,showAnswers:false,createdAt:serverTimestamp()});for(let f=0;f<6;f++)for(let l=0;l<3;l++){const id=qid(f,l),qr=ref('games',gid,'questions',id),pr=ref('games',gid,'publicQuestions',id);if(!(await getDoc(qr)).exists())await setDoc(qr,{field:fields[f],level:levels[l],points:points[l],text:'',type:'text',options:[],correct:'',alternatives:[],image:'',done:false});if(!(await getDoc(pr)).exists())await setDoc(pr,{field:fields[f],level:levels[l],points:points[l],text:'',type:'text',options:[],image:'',done:false})}for(let i=1;i<=9;i++){const tr=ref('games',gid,'teams',`team${i}`);if(!(await getDoc(tr)).exists())await setDoc(tr,{name:`${i}팀`,uid:'',score:0})}}
async function handleAuth(u){unsubs.forEach(fn=>fn());unsubs=[];if(clockTimer)clearInterval(clockTimer);user=u;admin=!!u&&u.uid===ADMIN_UID;game={};teams=[];questions=[];answers=[];loaded={game:false,teams:false,questions:false,answers:false};gradingDraft={};gradingId='';closing=false;visible('login',!u&&new URLSearchParams(location.search).has('admin'));visible('joinPanel',!u&&!new URLSearchParams(location.search).has('admin'));visible('app',!!u);visible('logout',!!u);visible('adminToolbar',admin);visible('qrOnlyView',false);visible('adminPanel',false);if($('adminToggle')){$('adminToggle').textContent='⚙ 관리자 설정';$('adminToggle').setAttribute('aria-expanded','false')}visible('adminActions',admin);text('who',u?(admin?'사회자':'참가자'):'');if(!u)return;try{if(admin)await initializeGame()}catch(e){error(e);return}
const listen=(target,kind,transform)=>unsubs.push(onSnapshot(target,s=>{if(!user)return;if(kind==='game')game=s.data()||{};else if(kind==='teams')teams=transform(s);else if(kind==='questions')questions=transform(s);else answers=transform(s);loaded[kind]=true;render()},error));
const docs=s=>s.docs.map(d=>({id:d.id,...d.data()}));listen(ref('games',gid),'game');listen(collection(db,'games',gid,'teams'),'teams',docs);listen(collection(db,'games',gid,admin?'questions':'publicQuestions'),'questions',docs);const ac=collection(db,'games',gid,'answers');listen(admin?ac:query(ac,where('uid','==',u.uid)),'answers',docs);clockTimer=setInterval(renderClock,200)}
function renderBoard(){
  const board=$('board');if(!board)return;
  const cs=counts(),visibleByField=fields.map((f,i)=>questions
    .filter(q=>q.field===f&&Number(q.id.split('-')[1])<cs[i]&&q.level!=='없음')
    .sort((a,b)=>(levels.indexOf(a.level)<0?3:levels.indexOf(a.level))-(levels.indexOf(b.level)<0?3:levels.indexOf(b.level))||
      Number(a.id.split('-')[1])-Number(b.id.split('-')[1])));
  let html=fields.map((f,i)=>`<div class="fieldhead">${f}<small style="display:block;font-size:13px">${visibleByField[i].length}문제</small></div>`).join('');
  const maxRows=Math.max(0,...visibleByField.map(qs=>qs.length));
  for(let row=0;row<maxRows;row++)for(let f=0;f<6;f++){
    const q=visibleByField[f][row];if(!q){html+='<div></div>';continue}
    const done=!!q.done,disabled=!admin||done||game.phase!=='board'||!loaded.questions;
    const level=levels.includes(q.level)?q.level:'하',index=Number(q.id.split('-')[1])+1;
    html+=`<button type="button" class="tile tile-${level==='하'?'low':level==='중'?'mid':'high'} ${done?'done':''}" data-q="${esc(q.id)}" ${disabled?'disabled':''}>${done?'✓':`${q.points??points[levels.indexOf(level)]}점`}<small>${done?'완료':level} · ${index}번</small></button>`;
  }
  board.innerHTML=html;
  board.querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>choose(b.dataset.q));
  text('counter',`${activeQuestions().filter(q=>q.done).length} / ${totalQuestions()}`);
}

function renderQrRegistration(){
 const count=$('qrRegistrationCount'),names=$('qrRegistrationNames');
 if(!count||!names)return;
 const registered=sortedTeams().filter(t=>!!t.uid);
 count.textContent=`등록 현황 ${registered.length} / 9팀`;
 names.innerHTML=registered.length?registered.map(t=>`<div class="qr-team-item" title="${esc(t.name)}">${esc(t.name)}</div>`).join(''):'<div class="qr-team-empty">아직 등록된 팀이 없습니다.</div>';
}
function renderRanking(){const el=$('ranking');if(!el)return;if(!loaded.teams){el.textContent='팀 정보를 불러오는 중입니다.';return}const sorted=[...teams].sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0)||String(a.name).localeCompare(String(b.name),'ko'));let prev=null,rank=0;el.innerHTML=sorted.map((t,i)=>{const score=Number(t.score)||0;if(prev!==score){rank=i+1;prev=score}return `<div class="rank"><span>${rank}위　${esc(t.name)}</span><strong>${score}점</strong></div>`}).join('')||'<p class="muted">등록된 팀이 없습니다.</p>'}
function render(){if(!user)return;
 if(!admin){const t=myTeam();visible('joinPanel',!t);visible('app',!!t);visible('participantBanner',!!t);if(t)text('participantBanner',`참가팀: ${t.name} · ${game.phase==='running'?'답안을 입력해 주세요':game.phase==='closed'?'채점 중입니다':game.phase==='ready'?'문제 준비 중입니다':'다음 문제를 기다려 주세요'}`);}
 renderBoard();renderRanking();renderQrRegistration();syncTimeInputs();const q=currentQ(),isBoard=game.phase==='board'||!q,closed=game.phase==='closed',running=game.phase==='running',ready=game.phase==='ready';// Explicit panel switching, independent of CSS :has()
visible('boardPanel',isBoard);visible('active',!isBoard);if(isBoard)return;text('questionMeta',`${q.field} · ${q.level} · ${q.points}점`);text('questionText',q.text||'(문제 미등록)');$('questionImage').innerHTML=q.image?`<img src="${esc(q.image)}" alt="문제 이미지">`:'';text('submitCount',`답안 제출 ${teams.filter(t=>answerFor(t.id)).length} / 9팀`);const submittedTeams=$('submittedTeams');if(submittedTeams){submittedTeams.innerHTML=admin&&running?sortedTeams().map(t=>{const sent=!!answerFor(t.id);return `<span class="team-chip ${sent?'sent':''}">${sent?'✓ ':''}${esc(t.name)}</span>`}).join(''):'';}visible('teamAnswer',!admin&&!!myTeam()&&running);if(!admin&&myTeam()&&running){const key=game.current+'|'+qType(q)+'|'+Boolean(answerFor(myTeam().id));if(renderedAnswerKey!==key){renderedAnswerKey=key;orderSelection=[];renderAnswerUi(q)}}else renderedAnswerKey='';$('submitBtn').disabled=!running||game.paused||remaining()<=0||submitting||!!(myTeam()&&answerFor(myTeam().id));if(qType(q)==='text'&&myTeam()&&document.activeElement!==$('answerInput'))$('answerInput').value=answerFor(myTeam().id)?.text||'';visible('reveal',closed&&admin);if(closed&&admin)text('correctText',answerLabel(q.correct,q)||'');visible('questionText',!closed);visible('questionImage',!closed);visible('clock',!closed);visible('submitCount',!closed);visible('submittedTeams',!closed&&admin);visible('controlButtons',admin&&!closed);visible('grading',admin&&closed);if(admin){$('startBtn').disabled=!ready||!q.text||!q.correct;$('startBtn').textContent=`${durationFor(q)}초 시작`;$('closeBtn').disabled=!running;$('pauseBtn').disabled=!running||!!game.paused;$('resumeBtn').disabled=!running||!game.paused;text('adminHint',ready?'문제를 확인한 후 60초 시작을 누르세요.':running?'시간이 끝나면 채점 화면으로 전환됩니다.':closed?'팀별 채점 후 점수 반영 및 다음 문제를 누르세요.':'');if(closed)renderGrades(q)}renderClock()}
function renderClock(){if(!user)return;const r=remaining();text('clock',`${String(Math.floor(r/60)).padStart(2,'0')}:${String(r%60).padStart(2,'0')}`);if(admin&&game.phase==='running'&&!game.paused&&r===0&&!closing){closing=true;closeQuestion().finally(()=>{closing=false})}}
let renderedAnswerKey='';
let choosing=false;
async function choose(id){
  if(!admin||game.phase!=='board'||choosing)return;
  const q=questions.find(x=>x.id===id);
  if(!q||q.done)return;
  if(!q.text?.trim()||!q.correct?.trim()){
    notice('문제와 정답을 먼저 등록해야 출제할 수 있습니다.');return;
  }
  choosing=true;
  const duration=durationFor(q);
  try{
    await runTransaction(db,async tx=>{
      const gr=ref('games',gid),gs=await tx.get(gr);
      if(gs.data()?.phase!=='board')throw Error('다른 문제가 이미 진행 중입니다.');
      tx.update(gr,{current:id,phase:'running',deadline:new Date(Date.now()+duration*1000),remaining:duration,paused:false,revealedCorrect:'',publishedAnswers:{}});
    });
    notice(`${q.field} · ${q.level} 문제 시작 (${duration}초)`);
  }catch(e){error(e)}finally{choosing=false}
}
$('startBtn').onclick=async()=>{if(!admin||game.phase!=='ready')return;const q=currentQ();if(!q?.text||!q?.correct){notice('문제와 정답을 먼저 등록하세요.');return}const duration=durationFor(q);try{await updateDoc(ref('games',gid),{phase:'running',deadline:new Date(Date.now()+duration*1000),remaining:duration,paused:false})}catch(e){error(e)}};
async function closeQuestion(){if(!admin||game.phase!=='running')return;try{await updateDoc(ref('games',gid),{phase:'closed',remaining:0,paused:false,revealedCorrect:currentQ()?.correct||'',publishedAnswers:{}})}catch(e){error(e)}}
$('closeBtn').onclick=closeQuestion;
$('pauseBtn').onclick=async()=>{if(!admin||game.phase!=='running')return;try{await updateDoc(ref('games',gid),{paused:true,remaining:remaining()})}catch(e){error(e)}};
$('resumeBtn').onclick=async()=>{if(!admin||game.phase!=='running'||!game.paused)return;try{await updateDoc(ref('games',gid),{paused:false,deadline:new Date(Date.now()+(game.remaining||0)*1000)})}catch(e){error(e)}};
$('submitBtn').onclick=async()=>{const t=myTeam(),q=currentQ(),type=qType(q),value=type==='choice'?(document.querySelector('input[name=quizChoice]:checked')?.value||''):type==='order'?orderSelection.join(','):$('answerInput').value.trim();if(type==='order'&&orderSelection.length!==4){notice('4개 항목을 순서대로 모두 선택하세요.');return}if(!t||!value){notice('답안을 입력하세요.');return}if(answerFor(t.id)){notice('이미 제출한 답안은 수정할 수 없습니다.');return}if(submitting)return;submitting=true;$('submitBtn').disabled=true;try{const gr=ref('games',gid),ar=ref('games',gid,'answers',`${game.current}_${t.id}`);await runTransaction(db,async tx=>{const snap=await tx.get(gr),s=snap.data();if(s.phase!=='running'||s.paused||!s.deadline||s.deadline.toMillis()<=Date.now())throw Error('제출 시간이 종료되었습니다.');tx.set(ar,{teamId:t.id,questionId:s.current,text:value,submittedAt:serverTimestamp(),uid:user.uid})});text('submitMsg','제출 완료');notice('답안이 저장되었습니다.')}catch(e){error(e)}finally{submitting=false;render()}};
// 정답(100%) 제출자에게 제출 당시 남은 제한시간(초)을 보너스로 부여합니다.
// Firebase 서버의 제출 시각과 문제 종료 시각을 비교하며, 초 단위로 올림합니다.
function gradeBreakdown(q){
 const result={}, end=game.deadline?.toMillis?.(), maxSeconds=durationFor(q);
 for(const t of sortedTeams()){
  const a=answerFor(t.id),pct=a?.text?(gradingDraft[t.id]??autoPercent(a,q)):0;
  const submitted=a?.submittedAt?.toMillis?.();
  const bonus=pct===100&&Number.isFinite(end)&&Number.isFinite(submitted)
   ?Math.min(maxSeconds,Math.max(0,Math.ceil((end-submitted)/1000))):0;
  result[t.id]={pct,base:Number(q.points)*pct/100,bonus};
 }
 return result;
}
function renderGrades(q){
 if(gradingId!==q.id){gradingId=q.id;gradingDraft={}}
 const el=$('gradingRows'),breakdown=gradeBreakdown(q);
 el.innerHTML=sortedTeams().map(t=>{
   const a=answerFor(t.id),hasAnswer=!!a?.text,pct=hasAnswer?(gradingDraft[t.id]??autoPercent(a,q)):0;
   const g=breakdown[t.id],bonusText=g.bonus?` <small style="color:#fbbf24;white-space:nowrap">+${g.bonus}점 (잔여 ${g.bonus}초)</small>`:'';
   return `<div class="grade-row"><strong>${esc(t.name)}${bonusText}</strong><span class="grade-answer">${hasAnswer?esc(answerLabel(a.text,q)):'<span class="muted">미제출</span>'}</span><div class="grade-buttons"><label class="grade-correct"><input type="checkbox" data-correct="${t.id}" ${pct===100?'checked':''} ${!hasAnswer?'disabled':''}>정답</label>${[100,50,0].map(p=>`<button type="button" data-grade="${t.id}" data-pct="${p}" class="${pct===p?'selected':''}" ${!hasAnswer?'disabled':''}>${p}%</button>`).join('')}</div></div>`
 }).join('');
 el.querySelectorAll('[data-grade]').forEach(b=>b.onclick=()=>{gradingDraft[b.dataset.grade]=Number(b.dataset.pct);renderGrades(q)});
 el.querySelectorAll('[data-correct]').forEach(c=>c.onchange=()=>{gradingDraft[c.dataset.correct]=c.checked?100:0;renderGrades(q)});
 $('finalizeBtn').disabled=finalizing;
}
$('finalizeBtn').onclick=async()=>{if(!admin||game.phase!=='closed'||finalizing)return;const q=currentQ();if(!q)return;const ordered=sortedTeams(),breakdown=gradeBreakdown(q),grades=Object.fromEntries(ordered.map(t=>[t.id,breakdown[t.id].base+breakdown[t.id].bonus])),bonuses=Object.fromEntries(ordered.map(t=>[t.id,breakdown[t.id].bonus]));if(!confirm('9팀 점수를 반영하고 다음 문제 선택판으로 이동할까요?'))return;finalizing=true;$('finalizeBtn').disabled=true;try{await runTransaction(db,async tx=>{const gr=ref('games',gid),qr=ref('games',gid,'questions',q.id),trs=ordered.map(t=>ref('games',gid,'teams',t.id));const [gs,qs,...ts]=await Promise.all([tx.get(gr),tx.get(qr),...trs.map(r=>tx.get(r))]);if(gs.data()?.phase!=='closed'||gs.data()?.current!==q.id||qs.data()?.done)throw Error('이미 채점되었거나 진행 상태가 변경되었습니다.');ordered.forEach((t,i)=>tx.update(trs[i],{score:(Number(ts[i].data()?.score)||0)+grades[t.id]}));tx.update(qr,{done:true,grades,bonuses});tx.update(ref('games',gid,'publicQuestions',q.id),{done:true});tx.update(gr,{phase:'board',current:'',deadline:null,remaining:60,paused:false,revealedCorrect:'',publishedAnswers:{}})});gradingDraft={};gradingId='';notice('점수 반영 완료. 다음 문제를 선택하세요.')}catch(e){error(e)}finally{finalizing=false;$('finalizeBtn').disabled=false}};
$('editTeams').onclick=()=>{if(!admin)return;$('editor').innerHTML='<h3>팀 정보 편집</h3>'+sortedTeams().map(t=>`<div class="fields"><div><label>${esc(t.id)} 팀 이름</label><input data-team-name="${t.id}" value="${esc(t.name)}"></div><div><label>로그인 UID</label><input data-team-uid="${t.id}" value="${esc(t.uid)}"></div></div>`).join('')+'<p><button id="saveTeams">팀 정보 저장</button></p>';$('saveTeams').onclick=async()=>{try{for(const t of sortedTeams())await updateDoc(ref('games',gid,'teams',t.id),{name:document.querySelector(`[data-team-name="${t.id}"]`).value.trim(),uid:document.querySelector(`[data-team-uid="${t.id}"]`).value.trim()});notice('팀 정보 저장 완료')}catch(e){error(e)}}};
async function saveQuestionCounts(){if(!admin)return;const values=fields.map((_,i)=>Number($('countField'+i).value));if(values.some(n=>!Number.isInteger(n)||n<1||n>10)){notice('각 분야는 1~10문제 사이로 설정하세요.');return}if(game.phase!=='board'){notice('문제 선택판에서만 문제 수를 변경할 수 있습니다.');return}const old=counts();if(values.some((n,i)=>n<old[i]&&questions.some(q=>q.field===fields[i]&&Number(q.id.split('-')[1])>=n&&q.done))){notice('이미 진행 완료한 문제는 숨길 수 없습니다.');return}try{for(let f=0;f<6;f++)for(let l=3;l<values[f];l++){const id=qid(f,l),level=levels[l%3],pt=points[l%3];const qr=ref('games',gid,'questions',id),pr=ref('games',gid,'publicQuestions',id);if(!(await getDoc(qr)).exists())await setDoc(qr,{field:fields[f],level,points:pt,text:'',type:'text',options:[],correct:'',alternatives:[],image:'',done:false});if(!(await getDoc(pr)).exists())await setDoc(pr,{field:fields[f],level,points:pt,text:'',type:'text',options:[],image:'',done:false})}await updateDoc(ref('games',gid),{questionCounts:values});notice(`문제 수 저장 완료: 총 ${values.reduce((a,b)=>a+b,0)}문제. 문제 편집에서 추가 문제를 등록하세요.`)}catch(e){error(e)}}
function renderCountSettings(){const area=$('questionCountSettings');if(!area||!admin)return;const cs=counts();area.innerHTML='<h3>🧩 분야별 문제 수 설정</h3><p class="muted small">각 분야 1~10문제 · 기본 3문제 · 기존 문제와 정답은 삭제되지 않습니다. 줄인 문제는 선택판에서만 숨겨집니다.</p><div class="count-grid">'+fields.map((f,i)=>`<label>${f}<input id="countField${i}" type="number" min="1" max="10" step="1" value="${cs[i]}"></label>`).join('')+'</div><p><button id="saveQuestionCounts" type="button">문제 수 적용 및 추가 문제 생성</button></p>'; $('saveQuestionCounts').onclick=saveQuestionCounts;}
$('editQuestions').onclick=()=>{if(!admin)return;const ordered=[];for(let f=0;f<6;f++)for(let l=0;l<counts()[f];l++){const q=questions.find(x=>x.id===qid(f,l));if(q)ordered.push(q)}$('editor').innerHTML='<h3>문제 편집</h3><label>문제 선택</label><select id="qSelect">'+ordered.map(q=>`<option value="${q.id}">${esc(q.field)} · ${Number(q.id.split('-')[1])+1}번 · ${esc(q.level)}${q.done?' (완료)':''}</option>`).join('')+'</select><div id="qFields"></div>';const fill=()=>{const q=questions.find(x=>x.id===$('qSelect').value);if(!q)return;$('qFields').innerHTML=`<label>난이도 / 출제 여부</label><select id="qLevel"><option value="하">하 — 50점 / 30초</option><option value="중">중 — 100점 / 60초</option><option value="상">상 — 150점 / 90초</option><option value="없음">문제 없음 — 출제 제외</option></select><p id="levelHint" class="muted small"></p><label>문제 유형</label><select id="qType"><option value="text">주관식</option><option value="choice">객관식 (4지선다)</option><option value="order">순서 배열형 (4개 항목)</option></select><label>문제 내용</label><textarea id="qText"></textarea><div id="optionFields"><label>보기 / 배열 항목 (4개)</label>${[0,1,2,3].map(i=>`<div class="option-editor"><span>${i+1}번</span><input id="qOption${i}" maxlength="160" placeholder="${i+1}번 항목"></div>`).join('')}</div><div id="textCorrect"><label>정답</label><input id="qCorrect"><label>인정할 유사 정답 (줄바꿈 구분)</label><textarea id="qAlt"></textarea></div><div id="choiceCorrect"><label>정답 번호</label><select id="qChoiceCorrect">${[1,2,3,4].map(i=>`<option value="${i}">${i}번</option>`).join('')}</select></div><div id="orderCorrect"><label>정답 순서 (각 번호를 한 번씩)</label><div class="order-correct-row">${[0,1,2,3].map(i=>`<select id="qOrder${i}">${[1,2,3,4].map(n=>`<option value="${n}">${n}번</option>`).join('')}</select>`).join('<span>→</span>')}</div></div><label>배점 (난이도에 따라 자동 적용)</label><input id="qPoints" type="number" readonly><label>이미지 URL (선택)</label><input id="qImage"><p><button id="saveQ">문제 저장</button></p>`;$('qLevel').value=['하','중','상','없음'].includes(q.level)?q.level:'하';$('qType').value=qType(q);$('qText').value=q.text||'';$('qCorrect').value=qType(q)==='text'?q.correct||'':'';$('qAlt').value=(q.alternatives||[]).join('\n');$('qImage').value=q.image||'';for(let i=0;i<4;i++)$('qOption'+i).value=q.options?.[i]||'';if(qType(q)==='choice')$('qChoiceCorrect').value=q.correct||'1';const seq=qType(q)==='order'?String(q.correct||'1,2,3,4').split(','):['1','2','3','4'];for(let i=0;i<4;i++)$('qOrder'+i).value=seq[i]||String(i+1);const typeChange=()=>{const type=$('qType').value;visible('optionFields',type!=='text');visible('textCorrect',type==='text');visible('choiceCorrect',type==='choice');visible('orderCorrect',type==='order')};$('qType').onchange=typeChange;typeChange();const levelChange=()=>{const level=$('qLevel').value;$('qPoints').value=level==='없음'?0:points[levels.indexOf(level)];text('levelHint',level==='없음'?'문제 선택판에서 숨깁니다. 기존 문제와 정답은 삭제하지 않습니다.':'선택한 난이도의 점수와 제한시간이 적용됩니다.')};$('qLevel').onchange=levelChange;levelChange();$('saveQ').onclick=async()=>{try{if(q.done)throw Error('채점 완료 문제는 수정할 수 없습니다.');if(game.phase!=='board')throw Error('문제 선택판에서만 문제를 수정할 수 있습니다.');const level=$('qLevel').value,type=$('qType').value,opts=[0,1,2,3].map(i=>$('qOption'+i).value.trim());if(level==='없음'){await updateDoc(ref('games',gid,'questions',q.id),{level:'없음',points:0});await updateDoc(ref('games',gid,'publicQuestions',q.id),{level:'없음',points:0});notice('문제 없음 저장 완료 — 선택판에서 제외됩니다. 내용과 정답은 보존됩니다.');return}if(type!=='text'&&opts.some(v=>!v))throw Error('보기 4개를 모두 입력하세요.');const seq=[0,1,2,3].map(i=>$('qOrder'+i).value),correct=type==='text'?$('qCorrect').value.trim():type==='choice'?$('qChoiceCorrect').value:seq.join(',');if(type==='order'&&new Set(seq).size!==4)throw Error('정답 순서는 1~4번을 한 번씩 선택해야 합니다.');if(!correct)throw Error('정답을 입력하세요.');const content={level,type,text:$('qText').value.trim(),correct,alternatives:type==='text'?$('qAlt').value.split('\n').map(x=>x.trim()).filter(Boolean):[],options:type==='text'?[]:opts,points:points[levels.indexOf(level)],image:$('qImage').value.trim()};if(!content.text)throw Error('문제 내용을 입력하세요.');await updateDoc(ref('games',gid,'questions',q.id),content);await updateDoc(ref('games',gid,'publicQuestions',q.id),{level,type,text:content.text,options:content.options,points:content.points,image:content.image});notice('문제 저장 완료')}catch(e){error(e)}}};$('qSelect').onchange=fill;fill()};
$('exportBtn').onclick=()=>{if(!admin)return;const rows=[['분야','난이도','문제','팀','제출답안','획득점수(보너스 포함)','남은 시간 보너스']];for(const q of questions)for(const t of sortedTeams()){const a=answers.find(x=>x.id===`${q.id}_${t.id}`);rows.push([q.field,q.level,q.text,t.name,a?.text||'',q.grades?.[t.id]??'',q.bonuses?.[t.id]??''])}rows.push([],['최종순위','팀명','누적점수']);[...teams].sort((a,b)=>(b.score||0)-(a.score||0)).forEach((t,i)=>rows.push([i+1,t.name,t.score||0]));const csv='\ufeff'+rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='퀴즈대회_결과.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};

// 관리자 설정은 필요할 때만 펼칩니다.
$('adminToggle').onclick=()=>{if(!admin)return;const panel=$('adminPanel'),opening=panel.classList.contains('hidden');visible('adminPanel',opening);$('adminToggle').textContent=opening?'⚙ 설정 닫기':'⚙ 관리자 설정';$('adminToggle').setAttribute('aria-expanded',String(opening));if(opening)renderCountSettings();if(opening)panel.scrollIntoView({behavior:'smooth',block:'start'});};

// 브라우저 기본 confirm 대신 화면 내 확인창을 사용합니다.
function actionDialog(title,message,buttonText,task){
  if(!admin){notice('관리자 계정으로 로그인해야 합니다.');return;}
  const dlg=$('actionDialog'),ok=$('dialogConfirm'),cancel=$('dialogCancel');
  text('dialogTitle',title);text('dialogMessage',message);text('dialogStatus','');
  ok.textContent=buttonText;ok.disabled=false;cancel.disabled=false;
  visible('actionDialog',true);
  const close=()=>{visible('actionDialog',false);ok.onclick=null;cancel.onclick=null;};
  cancel.onclick=close;
  ok.onclick=async()=>{
    ok.disabled=true;cancel.disabled=true;text('dialogStatus','Firebase에 저장하는 중입니다...');
    try{await task();close();}
    catch(e){console.error('관리자 작업 실패',e);text('dialogStatus','실패: '+(e?.message||String(e)));notice('오류: '+(e?.message||String(e)));ok.disabled=false;cancel.disabled=false;}
  };
}
function boardState(){return {phase:'board',current:'',deadline:null,remaining:60,paused:false,revealedCorrect:'',publishedAnswers:{}};}
$('backToBoard').addEventListener('click',()=>{
  actionDialog('문제 선택판으로 복귀','현재 문제를 중단하고 선택판으로 돌아갑니다.\n기존 팀 점수와 완료된 문제는 유지됩니다.','선택판으로 돌아가기',async()=>{
    // 진행 중단한 문제의 제출 답안을 삭제해야 같은 문제를 재출제할 수 있습니다.
    const active=game.current;
    if(active){
      const snap=await getDocs(collection(db,'games',gid,'answers'));
      const old=snap.docs.filter(d=>d.data().questionId===active);
      if(old.length){const b=writeBatch(db);old.forEach(d=>b.delete(d.ref));await b.commit();}
    }
    await updateDoc(ref('games',gid),boardState());
    gradingDraft={};gradingId='';notice('문제 선택판으로 돌아왔습니다. 점수는 유지됩니다.');
  });
});
$('resetGame').addEventListener('click',()=>{
  actionDialog('대회 전체 초기화','테스트 진행 기록을 초기화합니다.\n\n• 팀 점수: 모두 0점\n• 설정된 문제 완료 기록: 모두 해제\n• 제출 답안: 모두 삭제\n\n문제 내용·정답·팀 이름은 그대로 유지됩니다.\n이 작업은 되돌릴 수 없습니다.','전체 초기화 실행',async()=>{
    const snap=await getDocs(collection(db,'games',gid,'answers'));
    // Firestore 배치 최대 500회 제한을 피하기 위해 분할 처리
    const ops=[];
    snap.docs.forEach(d=>ops.push(b=>b.delete(d.ref)));
    for(const t of teams)ops.push(b=>b.update(ref('games',gid,'teams',t.id),{score:0}));
    for(const q of questions){
      ops.push(b=>b.update(ref('games',gid,'questions',q.id),{done:false,grades:{}}));
      ops.push(b=>b.update(ref('games',gid,'publicQuestions',q.id),{done:false}));
    }
    ops.push(b=>b.update(ref('games',gid),boardState()));
    for(let i=0;i<ops.length;i+=400){const batch=writeBatch(db);ops.slice(i,i+400).forEach(op=>op(batch));await batch.commit();}
    gradingDraft={};gradingId='';notice(`전체 초기화 완료: 0/${totalQuestions()}, 점수 0점, 제출 답안 삭제.`);
  });
});

// 테스트 참가팀 전체 해제: 팀명 예약 문서까지 함께 제거해야 동일 이름 재등록이 가능합니다.
$('resetParticipants').addEventListener('click',()=>{
  actionDialog('참가팀 등록 전체 초기화',
    '테스트용으로 등록된 9개 팀을 모두 해제합니다.\n\n• 팀 이름: 1팀~9팀으로 복원\n• 등록된 참가자 UID와 팀 이름 예약: 삭제\n• 점수·제출 답안·완료 기록: 모두 초기화\n• 문제 내용·정답·시간 설정: 유지\n\n실제 대회 시작 전에만 실행하세요.',
    '참가팀 등록 초기화',async()=>{
      const [namesSnap,answersSnap]=await Promise.all([
        getDocs(collection(db,'games',gid,'teamNames')),
        getDocs(collection(db,'games',gid,'answers'))
      ]);
      const ops=[];
      namesSnap.docs.forEach(d=>ops.push(b=>b.delete(d.ref)));
      answersSnap.docs.forEach(d=>ops.push(b=>b.delete(d.ref)));
      for(let i=1;i<=9;i++){
        const tr=ref('games',gid,'teams',`team${i}`);
        ops.push(b=>b.set(tr,{name:`${i}팀`,uid:'',nameKey:'',score:0},{merge:true}));
      }
      for(const q of questions){
        const id=q.id;
        ops.push(b=>b.update(ref('games',gid,'questions',id),{done:false,grades:{}}));
        ops.push(b=>b.update(ref('games',gid,'publicQuestions',id),{done:false}));
      }
      ops.push(b=>b.update(ref('games',gid),boardState()));
      for(let i=0;i<ops.length;i+=400){
        const batch=writeBatch(db);
        ops.slice(i,i+400).forEach(op=>op(batch));
        await batch.commit();
      }
      gradingDraft={};gradingId='';
      notice('참가팀 등록 초기화 완료. 9개 팀을 새로 등록할 수 있습니다.');
    });
});

// QR 전용 화면: 기존 대회 화면과 관리자 설정은 숨기되 진행 상태는 유지합니다.
let qrMode=false;
function setQrMode(open){
  if(!admin)return;
  qrMode=open;
  visible('qrOnlyView',open);
  visible('app',!open);
  if(open){visible('adminPanel',false);$('adminToggle').textContent='⚙ 관리자 설정';$('adminToggle').setAttribute('aria-expanded','false');showJoinQr();}
  $('qrToggle').textContent=open?'▦ QR 표시 중':'▦ 참가자 QR';
}
$('qrToggle').onclick=()=>setQrMode(!qrMode);
$('qrBack').onclick=()=>setQrMode(false);

// 관리자 전용 난이도별 타이머 설정. 진행 중인 문제에는 소급 적용하지 않습니다.
$('saveTimes').onclick=async()=>{
 if(!admin)return;const values=[Number($('timeLow').value),Number($('timeMid').value),Number($('timeHigh').value)];
 if(values.some(v=>!Number.isInteger(v)||v<5||v>600)){text('timeMsg','5~600초 사이의 정수를 입력하세요.');return}
 $('saveTimes').disabled=true;text('timeMsg','저장 중...');
 try{await updateDoc(ref('games',gid),{timeLimits:{하:values[0],중:values[1],상:values[2]}});text('timeMsg','저장 완료. 다음 문제부터 적용됩니다.')}
 catch(e){text('timeMsg','저장 실패: '+(e?.message||e));error(e)}finally{$('saveTimes').disabled=false}
};
