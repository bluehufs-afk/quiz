import {firebaseConfig,ADMIN_UID} from './config.js';
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth,onAuthStateChanged,signInWithEmailAndPassword,signInAnonymously,signOut} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {getFirestore,doc,collection,query,where,onSnapshot,getDoc,setDoc,updateDoc,runTransaction,serverTimestamp,writeBatch,getDocs} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
const $=id=>document.getElementById(id),fields=['경지','인력','노경','안전','환경','WCD'],levels=['하','중','상'],points=[50,100,150],gid='main';
const qid=(f,l)=>`${f}-${l}`,esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db,auth,user=null,admin=false,game={},teams=[],questions=[],answers=[],unsubs=[],clockTimer=null,closing=false,finalizing=false,submitting=false,gradingDraft={},gradingId='',loaded={game:false,teams:false,questions:false,answers:false};
const ref=(...p)=>doc(db,...p),visible=(id,yes)=>$(id)?.classList.toggle('hidden',!yes),text=(id,v)=>{if($(id))$(id).textContent=v},notice=s=>text('notice',s),error=e=>{console.error(e);notice('오류: '+(e?.message||e))};
const sortedTeams=()=>[...teams].sort((a,b)=>(Number(a.id.replace('team',''))||0)-(Number(b.id.replace('team',''))||0));
const currentQ=()=>questions.find(q=>q.id===game.current),myTeam=()=>teams.find(t=>t.uid===user?.uid),answerFor=id=>answers.find(a=>a.id===`${game.current}_${id}`),autoPercent=(a,q)=>a?.text&&q?.correct&&String(a.text).trim()===String(q.correct).trim()?100:0;
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
async function initializeGame(){const gr=ref('games',gid);if(!(await getDoc(gr)).exists())await setDoc(gr,{phase:'board',current:'',deadline:null,remaining:60,paused:false,showAnswers:false,createdAt:serverTimestamp()});for(let f=0;f<6;f++)for(let l=0;l<3;l++){const id=qid(f,l),qr=ref('games',gid,'questions',id),pr=ref('games',gid,'publicQuestions',id);if(!(await getDoc(qr)).exists())await setDoc(qr,{field:fields[f],level:levels[l],points:points[l],text:'',correct:'',alternatives:[],image:'',done:false});if(!(await getDoc(pr)).exists())await setDoc(pr,{field:fields[f],level:levels[l],points:points[l],text:'',image:'',done:false})}for(let i=1;i<=9;i++){const tr=ref('games',gid,'teams',`team${i}`);if(!(await getDoc(tr)).exists())await setDoc(tr,{name:`${i}팀`,uid:'',score:0})}}
async function handleAuth(u){unsubs.forEach(fn=>fn());unsubs=[];if(clockTimer)clearInterval(clockTimer);user=u;admin=!!u&&u.uid===ADMIN_UID;game={};teams=[];questions=[];answers=[];loaded={game:false,teams:false,questions:false,answers:false};gradingDraft={};gradingId='';closing=false;visible('login',!u&&new URLSearchParams(location.search).has('admin'));visible('joinPanel',!u&&!new URLSearchParams(location.search).has('admin'));visible('app',!!u);visible('logout',!!u);visible('adminToolbar',admin);visible('qrOnlyView',false);visible('adminPanel',false);if($('adminToggle')){$('adminToggle').textContent='⚙ 관리자 설정';$('adminToggle').setAttribute('aria-expanded','false')}visible('adminActions',admin);text('who',u?(admin?'사회자':'참가자'):'');if(!u)return;try{if(admin)await initializeGame()}catch(e){error(e);return}
const listen=(target,kind,transform)=>unsubs.push(onSnapshot(target,s=>{if(!user)return;if(kind==='game')game=s.data()||{};else if(kind==='teams')teams=transform(s);else if(kind==='questions')questions=transform(s);else answers=transform(s);loaded[kind]=true;render()},error));
const docs=s=>s.docs.map(d=>({id:d.id,...d.data()}));listen(ref('games',gid),'game');listen(collection(db,'games',gid,'teams'),'teams',docs);listen(collection(db,'games',gid,admin?'questions':'publicQuestions'),'questions',docs);const ac=collection(db,'games',gid,'answers');listen(admin?ac:query(ac,where('uid','==',u.uid)),'answers',docs);clockTimer=setInterval(renderClock,200)}
function renderBoard(){const board=$('board');if(!board)return;let html=fields.map(f=>`<div class="fieldhead">${f}</div>`).join('');for(let l=0;l<3;l++)for(let f=0;f<6;f++){const id=qid(f,l),q=questions.find(x=>x.id===id),done=!!q?.done,disabled=!admin||done||game.phase!=='board'||!loaded.questions;html+=`<button type="button" class="tile ${done?'done':''}" data-q="${id}" ${disabled?'disabled':''}>${done?'✓':`${q?.points??points[l]}점`}<small>${done?'완료':levels[l]}</small></button>`}board.innerHTML=html;board.querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>choose(b.dataset.q));text('counter',`${questions.filter(q=>q.done).length} / 18`)}
function renderRanking(){const el=$('ranking');if(!el)return;if(!loaded.teams){el.textContent='팀 정보를 불러오는 중입니다.';return}const sorted=[...teams].sort((a,b)=>(Number(b.score)||0)-(Number(a.score)||0)||String(a.name).localeCompare(String(b.name),'ko'));let prev=null,rank=0;el.innerHTML=sorted.map((t,i)=>{const score=Number(t.score)||0;if(prev!==score){rank=i+1;prev=score}return `<div class="rank"><span>${rank}위　${esc(t.name)}</span><strong>${score}점</strong></div>`}).join('')||'<p class="muted">등록된 팀이 없습니다.</p>'}
function render(){if(!user)return;
 if(!admin){const t=myTeam();visible('joinPanel',!t);visible('app',!!t);visible('participantBanner',!!t);if(t)text('participantBanner',`참가팀: ${t.name} · ${game.phase==='running'?'답안을 입력해 주세요':game.phase==='closed'?'채점 중입니다':game.phase==='ready'?'문제 준비 중입니다':'다음 문제를 기다려 주세요'}`);}
 renderBoard();renderRanking();syncTimeInputs();const q=currentQ(),isBoard=game.phase==='board'||!q,closed=game.phase==='closed',running=game.phase==='running',ready=game.phase==='ready';// Explicit panel switching, independent of CSS :has()
visible('boardPanel',isBoard);visible('active',!isBoard);if(isBoard)return;text('questionMeta',`${q.field} · ${q.level} · ${q.points}점`);text('questionText',q.text||'(문제 미등록)');$('questionImage').innerHTML=q.image?`<img src="${esc(q.image)}" alt="문제 이미지">`:'';text('submitCount',`답안 제출 ${teams.filter(t=>answerFor(t.id)).length} / 9팀`);const submittedTeams=$('submittedTeams');if(submittedTeams){submittedTeams.innerHTML=admin&&running?sortedTeams().map(t=>{const sent=!!answerFor(t.id);return `<span class="team-chip ${sent?'sent':''}">${sent?'✓ ':''}${esc(t.name)}</span>`}).join(''):'';}visible('teamAnswer',!admin&&!!myTeam()&&running);$('submitBtn').disabled=!running||game.paused||remaining()<=0||submitting;if(myTeam()&&document.activeElement!==$('answerInput'))$('answerInput').value=answerFor(myTeam().id)?.text||'';visible('reveal',closed&&admin);if(closed&&admin)text('correctText',q.correct||'');visible('questionText',!closed);visible('questionImage',!closed);visible('clock',!closed);visible('submitCount',!closed);visible('submittedTeams',!closed&&admin);visible('controlButtons',admin&&!closed);visible('grading',admin&&closed);if(admin){$('startBtn').disabled=!ready||!q.text||!q.correct;$('startBtn').textContent=`${durationFor(q)}초 시작`;$('closeBtn').disabled=!running;$('pauseBtn').disabled=!running||!!game.paused;$('resumeBtn').disabled=!running||!game.paused;text('adminHint',ready?'문제를 확인한 후 60초 시작을 누르세요.':running?'시간이 끝나면 채점 화면으로 전환됩니다.':closed?'팀별 채점 후 점수 반영 및 다음 문제를 누르세요.':'');if(closed)renderGrades(q)}renderClock()}
function renderClock(){if(!user)return;const r=remaining();text('clock',`${String(Math.floor(r/60)).padStart(2,'0')}:${String(r%60).padStart(2,'0')}`);if(admin&&game.phase==='running'&&!game.paused&&r===0&&!closing){closing=true;closeQuestion().finally(()=>{closing=false})}}
async function choose(id){if(!admin||game.phase!=='board')return;const q=questions.find(x=>x.id===id);if(!q||q.done)return;try{await updateDoc(ref('games',gid),{current:id,phase:'ready',deadline:null,remaining:durationFor(q),paused:false,revealedCorrect:'',publishedAnswers:{}})}catch(e){error(e)}}
$('startBtn').onclick=async()=>{if(!admin||game.phase!=='ready')return;const q=currentQ();if(!q?.text||!q?.correct){notice('문제와 정답을 먼저 등록하세요.');return}const duration=durationFor(q);try{await updateDoc(ref('games',gid),{phase:'running',deadline:new Date(Date.now()+duration*1000),remaining:duration,paused:false})}catch(e){error(e)}};
async function closeQuestion(){if(!admin||game.phase!=='running')return;try{await updateDoc(ref('games',gid),{phase:'closed',remaining:0,paused:false,revealedCorrect:currentQ()?.correct||'',publishedAnswers:{}})}catch(e){error(e)}}
$('closeBtn').onclick=closeQuestion;
$('pauseBtn').onclick=async()=>{if(!admin||game.phase!=='running')return;try{await updateDoc(ref('games',gid),{paused:true,remaining:remaining()})}catch(e){error(e)}};
$('resumeBtn').onclick=async()=>{if(!admin||game.phase!=='running'||!game.paused)return;try{await updateDoc(ref('games',gid),{paused:false,deadline:new Date(Date.now()+(game.remaining||0)*1000)})}catch(e){error(e)}};
$('submitBtn').onclick=async()=>{const t=myTeam(),value=$('answerInput').value.trim();if(!t||!value){notice('답안을 입력하세요.');return}if(submitting)return;submitting=true;$('submitBtn').disabled=true;try{const gr=ref('games',gid),ar=ref('games',gid,'answers',`${game.current}_${t.id}`);await runTransaction(db,async tx=>{const snap=await tx.get(gr),s=snap.data();if(s.phase!=='running'||s.paused||!s.deadline||s.deadline.toMillis()<=Date.now())throw Error('제출 시간이 종료되었습니다.');tx.set(ar,{teamId:t.id,questionId:s.current,text:value,submittedAt:serverTimestamp(),uid:user.uid})});text('submitMsg','제출 완료');notice('답안이 저장되었습니다.')}catch(e){error(e)}finally{submitting=false;render()}};
function renderGrades(q){
 if(gradingId!==q.id){gradingId=q.id;gradingDraft={}}
 const el=$('gradingRows');
 el.innerHTML=sortedTeams().map(t=>{
   const a=answerFor(t.id),hasAnswer=!!a?.text,pct=hasAnswer?(gradingDraft[t.id]??autoPercent(a,q)):0;
   return `<div class="grade-row"><strong>${esc(t.name)}</strong><span class="grade-answer">${hasAnswer?esc(a.text):'<span class="muted">미제출</span>'}</span><div class="grade-buttons"><label class="grade-correct"><input type="checkbox" data-correct="${t.id}" ${pct===100?'checked':''} ${!hasAnswer?'disabled':''}>정답</label>${[100,50,0].map(p=>`<button type="button" data-grade="${t.id}" data-pct="${p}" class="${pct===p?'selected':''}" ${!hasAnswer?'disabled':''}>${p}%</button>`).join('')}</div></div>`
 }).join('');
 el.querySelectorAll('[data-grade]').forEach(b=>b.onclick=()=>{gradingDraft[b.dataset.grade]=Number(b.dataset.pct);renderGrades(q)});
 el.querySelectorAll('[data-correct]').forEach(c=>c.onchange=()=>{gradingDraft[c.dataset.correct]=c.checked?100:0;renderGrades(q)});
 $('finalizeBtn').disabled=finalizing;
}
$('finalizeBtn').onclick=async()=>{if(!admin||game.phase!=='closed'||finalizing)return;const q=currentQ();if(!q)return;const ordered=sortedTeams(),grades=Object.fromEntries(ordered.map(t=>{const a=answerFor(t.id),pct=a?.text?(gradingDraft[t.id]??autoPercent(a,q)):0;return [t.id,Number(q.points)*pct/100]}));if(!confirm('9팀 점수를 반영하고 다음 문제 선택판으로 이동할까요?'))return;finalizing=true;$('finalizeBtn').disabled=true;try{await runTransaction(db,async tx=>{const gr=ref('games',gid),qr=ref('games',gid,'questions',q.id),trs=ordered.map(t=>ref('games',gid,'teams',t.id));const [gs,qs,...ts]=await Promise.all([tx.get(gr),tx.get(qr),...trs.map(r=>tx.get(r))]);if(gs.data()?.phase!=='closed'||gs.data()?.current!==q.id||qs.data()?.done)throw Error('이미 채점되었거나 진행 상태가 변경되었습니다.');ordered.forEach((t,i)=>tx.update(trs[i],{score:(Number(ts[i].data()?.score)||0)+grades[t.id]}));tx.update(qr,{done:true,grades});tx.update(ref('games',gid,'publicQuestions',q.id),{done:true});tx.update(gr,{phase:'board',current:'',deadline:null,remaining:60,paused:false,revealedCorrect:'',publishedAnswers:{}})});gradingDraft={};gradingId='';notice('점수 반영 완료. 다음 문제를 선택하세요.')}catch(e){error(e)}finally{finalizing=false;$('finalizeBtn').disabled=false}};
$('editTeams').onclick=()=>{if(!admin)return;$('editor').innerHTML='<h3>팀 정보 편집</h3>'+sortedTeams().map(t=>`<div class="fields"><div><label>${esc(t.id)} 팀 이름</label><input data-team-name="${t.id}" value="${esc(t.name)}"></div><div><label>로그인 UID</label><input data-team-uid="${t.id}" value="${esc(t.uid)}"></div></div>`).join('')+'<p><button id="saveTeams">팀 정보 저장</button></p>';$('saveTeams').onclick=async()=>{try{for(const t of sortedTeams())await updateDoc(ref('games',gid,'teams',t.id),{name:document.querySelector(`[data-team-name="${t.id}"]`).value.trim(),uid:document.querySelector(`[data-team-uid="${t.id}"]`).value.trim()});notice('팀 정보 저장 완료')}catch(e){error(e)}}};
$('editQuestions').onclick=()=>{if(!admin)return;const ordered=[];for(let f=0;f<6;f++)for(let l=0;l<3;l++){const q=questions.find(x=>x.id===qid(f,l));if(q)ordered.push(q)}$('editor').innerHTML='<h3>문제 편집</h3><label>문제 선택</label><select id="qSelect">'+ordered.map(q=>`<option value="${q.id}">${esc(q.field)} · ${esc(q.level)}${q.done?' (완료)':''}</option>`).join('')+'</select><div id="qFields"></div>';const fill=()=>{const q=questions.find(x=>x.id===$('qSelect').value);if(!q)return;$('qFields').innerHTML='<label>문제 내용</label><textarea id="qText"></textarea><label>정답</label><input id="qCorrect"><label>인정할 유사 정답 (줄바꿈 구분)</label><textarea id="qAlt"></textarea><label>배점</label><input id="qPoints" type="number" min="1"><label>이미지 URL (선택)</label><input id="qImage"><p><button id="saveQ">문제 저장</button></p>';$('qText').value=q.text||'';$('qCorrect').value=q.correct||'';$('qAlt').value=(q.alternatives||[]).join('\n');$('qPoints').value=q.points;$('qImage').value=q.image||'';$('saveQ').onclick=async()=>{try{if(q.done)throw Error('채점 완료 문제는 수정할 수 없습니다.');const content={text:$('qText').value.trim(),correct:$('qCorrect').value.trim(),alternatives:$('qAlt').value.split('\n').map(x=>x.trim()).filter(Boolean),points:Number($('qPoints').value),image:$('qImage').value.trim()};if(!Number.isFinite(content.points)||content.points<=0)throw Error('배점을 확인하세요.');await updateDoc(ref('games',gid,'questions',q.id),content);await updateDoc(ref('games',gid,'publicQuestions',q.id),{text:content.text,points:content.points,image:content.image});notice('문제 저장 완료')}catch(e){error(e)}}};$('qSelect').onchange=fill;fill()};
$('exportBtn').onclick=()=>{if(!admin)return;const rows=[['분야','난이도','문제','팀','제출답안','획득점수']];for(const q of questions)for(const t of sortedTeams()){const a=answers.find(x=>x.id===`${q.id}_${t.id}`);rows.push([q.field,q.level,q.text,t.name,a?.text||'',q.grades?.[t.id]??''])}rows.push([],['최종순위','팀명','누적점수']);[...teams].sort((a,b)=>(b.score||0)-(a.score||0)).forEach((t,i)=>rows.push([i+1,t.name,t.score||0]));const csv='\ufeff'+rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='퀴즈대회_결과.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};

// 관리자 설정은 필요할 때만 펼칩니다.
$('adminToggle').onclick=()=>{if(!admin)return;const panel=$('adminPanel'),opening=panel.classList.contains('hidden');visible('adminPanel',opening);$('adminToggle').textContent=opening?'⚙ 설정 닫기':'⚙ 관리자 설정';$('adminToggle').setAttribute('aria-expanded',String(opening));if(opening)panel.scrollIntoView({behavior:'smooth',block:'start'});};

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
  actionDialog('대회 전체 초기화','테스트 진행 기록을 초기화합니다.\n\n• 팀 점수: 모두 0점\n• 18문제 완료 기록: 모두 해제\n• 제출 답안: 모두 삭제\n\n문제 내용·정답·팀 이름은 그대로 유지됩니다.\n이 작업은 되돌릴 수 없습니다.','전체 초기화 실행',async()=>{
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
    gradingDraft={};gradingId='';notice('전체 초기화 완료: 0/18, 점수 0점, 제출 답안 삭제.');
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
