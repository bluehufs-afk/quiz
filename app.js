
import {firebaseConfig,ADMIN_UID} from './config.js';
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {getAuth,onAuthStateChanged,signInWithEmailAndPassword,signOut} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {getFirestore,doc,collection,query,where,onSnapshot,getDoc,setDoc,updateDoc,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const $=id=>document.getElementById(id);
const fields=['경지','인력','노경','안전','환경','WCD'];
const levels=['하','중','상'];
const points=[50,100,150];
const gid='main';

const qid=(f,l)=>`${f}-${l}`;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;',
  '"':'&quot;',"'":'&#39;'
}[c]));

let db,auth,user=null,admin=false;
let game={},teams=[],questions=[],answers=[];
let unsubs=[],clockTimer=null;
let closing=false,finalizing=false,submitting=false;
let gradingDraft={},gradingId='';
let loaded={
  game:false,teams:false,questions:false,answers:false
};

const ref=(...p)=>doc(db,...p);
const visible=(id,yes)=>$(id)?.classList.toggle('hidden',!yes);
const text=(id,v)=>{
  if($(id))$(id).textContent=v;
};
const notice=s=>text('notice',s);
const error=e=>{
  console.error(e);
  notice('오류: '+(e?.message||e));
};

const sortedTeams=()=>[...teams].sort((a,b)=>
  (Number(a.id.replace('team',''))||0)-
  (Number(b.id.replace('team',''))||0)
);

const currentQ=()=>questions.find(q=>q.id===game.current);
const myTeam=()=>teams.find(t=>t.uid===user?.uid);
const answerFor=id=>answers.find(a=>
  a.id===`${game.current}_${id}`
);

const autoPercent=(a,q)=>
  a?.text&&q?.correct&&
  String(a.text).trim()===String(q.correct).trim()
    ?100:0;

function remaining(){
  if(game.phase!=='running'||game.paused){
    return game.remaining??60;
  }
  const end=game.deadline?.toMillis?.();
  return end
    ?Math.max(0,Math.ceil((end-Date.now())/1000))
    :game.remaining??60;
}

// Firebase 연결
if(!firebaseConfig?.projectId||!ADMIN_UID){
  visible('setup',true);
  notice('Firebase 설정을 확인하세요.');
}else{
  try{
    const app=initializeApp(firebaseConfig);
    auth=getAuth(app);
    db=getFirestore(app);
    onAuthStateChanged(auth,handleAuth);
  }catch(e){
    error(e);
  }
}

$('loginBtn').onclick=async()=>{
  try{
    await signInWithEmailAndPassword(
      auth,$('email').value.trim(),$('password').value
    );
  }catch(e){
    error(e);
  }
};

$('logout').onclick=()=>signOut(auth);

// 최초 데이터 생성: 기존 데이터는 보존
async function initializeGame(){
  const gr=ref('games',gid);

  if(!(await getDoc(gr)).exists()){
    await setDoc(gr,{
      phase:'board',
      current:'',
      deadline:null,
      remaining:60,
      paused:false,
      showAnswers:false,
      createdAt:serverTimestamp()
    });
  }

  for(let f=0;f<6;f++){
    for(let l=0;l<3;l++){
      const id=qid(f,l);
      const qr=ref('games',gid,'questions',id);
      const pr=ref('games',gid,'publicQuestions',id);

      if(!(await getDoc(qr)).exists()){
        await setDoc(qr,{
          field:fields[f],
          level:levels[l],
          points:points[l],
          text:'',
          correct:'',
          alternatives:[],
          image:'',
          done:false
        });
      }

      if(!(await getDoc(pr)).exists()){
        await setDoc(pr,{
          field:fields[f],
          level:levels[l],
          points:points[l],
          text:'',
          image:'',
          done:false
        });
      }
    }
  }

  for(let i=1;i<=9;i++){
    const tr=ref('games',gid,'teams',`team${i}`);

    if(!(await getDoc(tr)).exists()){
      await setDoc(tr,{
        name:`${i}팀`,
        uid:'',
        score:0
      });
    }
  }
}

// 로그인 및 실시간 데이터 연결
async function handleAuth(u){
  unsubs.forEach(fn=>fn());
  unsubs=[];

  if(clockTimer)clearInterval(clockTimer);

  user=u;
  admin=!!u&&u.uid===ADMIN_UID;

  game={};
  teams=[];
  questions=[];
  answers=[];

  loaded={
    game:false,teams:false,
    questions:false,answers:false
  };

  gradingDraft={};
  gradingId='';
  closing=false;

  visible('login',!u);
  visible('app',!!u);
  visible('logout',!!u);
  visible('adminToolbar',admin);
  visible('adminPanel',false);
  visible('adminActions',admin);

  if($('adminToggle')){
    $('adminToggle').textContent='⚙ 관리자 설정 열기';
    $('adminToggle').setAttribute('aria-expanded','false');
  }

  text('who',u?(admin?'사회자':'참가자'):'');

  if(!u)return;

  try{
    if(admin)await initializeGame();
  }catch(e){
    error(e);
    return;
  }

  const listen=(target,kind,transform)=>{
    unsubs.push(onSnapshot(
      target,
      s=>{
        if(!user)return;

        if(kind==='game'){
          game=s.data()||{};
        }else if(kind==='teams'){
          teams=transform(s);
        }else if(kind==='questions'){
          questions=transform(s);
        }else{
          answers=transform(s);
        }

        loaded[kind]=true;
        render();
      },
      error
    ));
  };

  const docs=s=>s.docs.map(d=>({
    id:d.id,...d.data()
  }));

  listen(ref('games',gid),'game');
  listen(collection(db,'games',gid,'teams'),'teams',docs);

  listen(
    collection(
      db,'games',gid,
      admin?'questions':'publicQuestions'
    ),
    'questions',
    docs
  );

  const ac=collection(db,'games',gid,'answers');

  listen(
    admin
      ?ac
      :query(ac,where('uid','==',u.uid)),
    'answers',
    docs
  );

  clockTimer=setInterval(renderClock,200);
}

// 18문제 선택판
function renderBoard(){
  const board=$('board');
  if(!board)return;

  let html=fields.map(f=>
    `<div class="fieldhead">${f}</div>`
  ).join('');

  for(let l=0;l<3;l++){
    for(let f=0;f<6;f++){
      const id=qid(f,l);
      const q=questions.find(x=>x.id===id);
      const done=!!q?.done;

      const disabled=
        !admin||
        done||
        game.phase!=='board'||
        !loaded.questions;

      html+=`
        <button
          type="button"
          class="tile ${done?'done':''}"
          data-q="${id}"
          ${disabled?'disabled':''}
        >
          ${done?'✓':`${q?.points??points[l]}점`}
          <small>${done?'완료':levels[l]}</small>
        </button>
      `;
    }
  }

  board.innerHTML=html;

  board.querySelectorAll('[data-q]').forEach(b=>{
    b.onclick=()=>choose(b.dataset.q);
  });

  text(
    'counter',
    `${questions.filter(q=>q.done).length} / 18`
  );
}

// 실시간 순위
function renderRanking(){
  const el=$('ranking');
  if(!el)return;

  if(!loaded.teams){
    el.textContent='팀 정보를 불러오는 중입니다.';
    return;
  }

  const sorted=[...teams].sort((a,b)=>
    (Number(b.score)||0)-(Number(a.score)||0)||
    String(a.name).localeCompare(String(b.name),'ko')
  );

  let prev=null;
  let rank=0;

  el.innerHTML=sorted.map((t,i)=>{
    const score=Number(t.score)||0;

    if(prev!==score){
      rank=i+1;
      prev=score;
    }

    return `
      <div class="rank">
        <span>${rank}위　${esc(t.name)}</span>
        <strong>${score}점</strong>
      </div>
    `;
  }).join('')||
    '<p class="muted">등록된 팀이 없습니다.</p>';
}

// 화면 갱신
function render(){
  if(!user)return;

  renderBoard();
  renderRanking();

  const q=currentQ();
  const isBoard=game.phase==='board'||!q;
  const closed=game.phase==='closed';
  const running=game.phase==='running';
  const ready=game.phase==='ready';

  visible('boardPanel',isBoard);
  visible('active',!isBoard);

  if(isBoard)return;

  text(
    'questionMeta',
    `${q.field} · ${q.level} · ${q.points}점`
  );

  text('questionText',q.text||'(문제 미등록)');

  $('questionImage').innerHTML=q.image
    ?`<img src="${esc(q.image)}" alt="문제 이미지">`
    :'';

  text(
    'submitCount',
    `답안 제출 ${
      teams.filter(t=>answerFor(t.id)).length
    } / 9팀`
  );

  visible(
    'teamAnswer',
    !admin&&!!myTeam()&&running
  );

  $('submitBtn').disabled=
    !running||
    game.paused||
    remaining()<=0||
    submitting;

  if(
    myTeam()&&
    document.activeElement!==$('answerInput')
  ){
    $('answerInput').value=
      answerFor(myTeam().id)?.text||'';
  }

  visible('reveal',closed&&admin);

  if(closed&&admin){
    text('correctText',q.correct||'');
  }

  visible('questionText',!closed);
  visible('questionImage',!closed);
  visible('clock',!closed);
  visible('submitCount',!closed);
  visible('controlButtons',admin&&!closed);
  visible('grading',admin&&closed);

  if(admin){
    $('startBtn').disabled=
      !ready||!q.text||!q.correct;

    $('closeBtn').disabled=!running;
    $('pauseBtn').disabled=
      !running||!!game.paused;
    $('resumeBtn').disabled=
      !running||!game.paused;

    text(
      'adminHint',
      ready
        ?'문제를 확인한 후 60초 시작을 누르세요.'
        :running
          ?'시간이 끝나면 채점 화면으로 전환됩니다.'
          :closed
            ?'팀별 채점 후 점수 반영 및 다음 문제를 누르세요.'
            :''
    );

    if(closed)renderGrades(q);
  }

  renderClock();
}

// 타이머
function renderClock(){
  if(!user)return;

  const r=remaining();

  text(
    'clock',
    `${String(Math.floor(r/60)).padStart(2,'0')}:`+
    `${String(r%60).padStart(2,'0')}`
  );

  if(
    admin&&
    game.phase==='running'&&
    !game.paused&&
    r===0&&
    !closing
  ){
    closing=true;

    closeQuestion().finally(()=>{
      closing=false;
    });
  }
}

// 문제 선택
async function choose(id){
  if(!admin||game.phase!=='board')return;

  const q=questions.find(x=>x.id===id);
  if(!q||q.done)return;

  try{
    await updateDoc(ref('games',gid),{
      current:id,
      phase:'ready',
      deadline:null,
      remaining:60,
      paused:false,
      revealedCorrect:'',
      publishedAnswers:{}
    });
  }catch(e){
    error(e);
  }
}

// 문제 시작
$('startBtn').onclick=async()=>{
  if(!admin||game.phase!=='ready')return;

  const q=currentQ();

  if(!q?.text||!q?.correct){
    notice('문제와 정답을 먼저 등록하세요.');
    return;
  }

  try{
    await updateDoc(ref('games',gid),{
      phase:'running',
      deadline:new Date(Date.now()+60000),
      remaining:60,
      paused:false
    });
  }catch(e){
    error(e);
  }
};

// 문제 마감
async function closeQuestion(){
  if(!admin||game.phase!=='running')return;

  try{
    await updateDoc(ref('games',gid),{
      phase:'closed',
      remaining:0,
      paused:false,
      revealedCorrect:currentQ()?.correct||'',
      publishedAnswers:{}
    });
  }catch(e){
    error(e);
  }
}

$('closeBtn').onclick=closeQuestion;

// 일시정지
$('pauseBtn').onclick=async()=>{
  if(!admin||game.phase!=='running')return;

  try{
    await updateDoc(ref('games',gid),{
      paused:true,
      remaining:remaining()
    });
  }catch(e){
    error(e);
  }
};

// 재개
$('resumeBtn').onclick=async()=>{
  if(
    !admin||
    game.phase!=='running'||
    !game.paused
  )return;

  try{
    await updateDoc(ref('games',gid),{
      paused:false,
      deadline:new Date(
        Date.now()+(game.remaining||0)*1000
      )
    });
  }catch(e){
    error(e);
  }
};

// 참가자 답안 제출
$('submitBtn').onclick=async()=>{
  const t=myTeam();
  const value=$('answerInput').value.trim();

  if(!t||!value){
    notice('답안을 입력하세요.');
    return;
  }

  if(submitting)return;

  submitting=true;
  $('submitBtn').disabled=true;

  try{
    const gr=ref('games',gid);
    const ar=ref(
      'games',gid,'answers',
      `${game.current}_${t.id}`
    );

    await runTransaction(db,async tx=>{
      const snap=await tx.get(gr);
      const s=snap.data();

      if(
        s.phase!=='running'||
        s.paused||
        !s.deadline||
        s.deadline.toMillis()<=Date.now()
      ){
        throw Error('제출 시간이 종료되었습니다.');
      }

      tx.set(ar,{
        teamId:t.id,
        questionId:s.current,
        text:value,
        submittedAt:serverTimestamp(),
        uid:user.uid
      });
    });

    text('submitMsg','제출 완료');
    notice('답안이 저장되었습니다.');
  }catch(e){
    error(e);
  }finally{
    submitting=false;
    render();
  }
};

// 팀별 채점
function renderGrades(q){
  if(gradingId!==q.id){
    gradingId=q.id;
    gradingDraft={};
  }

  const el=$('gradingRows');

  el.innerHTML=sortedTeams().map(t=>{
    const a=answerFor(t.id);

    const pct=a?.text
      ?(gradingDraft[t.id]??autoPercent(a,q))
      :0;

    return `
      <div class="grade-row">
        <strong>${esc(t.name)}</strong>

        <span class="grade-answer">
          ${
            a?.text
              ?esc(a.text)
              :'<span class="muted">미제출</span>'
          }
        </span>

        <div class="grade-buttons">
          ${[100,50,0].map(p=>`
            <button
              type="button"
              data-grade="${t.id}"
              data-pct="${p}"
              class="${pct===p?'selected':''}"
              ${!a?.text?'disabled':''}
            >
              ${p}%
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');

  el.querySelectorAll('[data-grade]').forEach(b=>{
    b.onclick=()=>{
      gradingDraft[b.dataset.grade]=Number(b.dataset.pct);
      renderGrades(q);
    };
  });

  $('finalizeBtn').disabled=finalizing;
}

// 점수 반영 후 문제 선택판으로 복귀
$('finalizeBtn').onclick=async()=>{
  if(
    !admin||
    game.phase!=='closed'||
    finalizing
  )return;

  const q=currentQ();
  if(!q)return;

  const ordered=sortedTeams();

  const grades=Object.fromEntries(
    ordered.map(t=>{
      const a=answerFor(t.id);

      const pct=a?.text
        ?(gradingDraft[t.id]??autoPercent(a,q))
        :0;

      return [
        t.id,
        Number(q.points)*pct/100
      ];
    })
  );

  if(!confirm(
    '9팀 점수를 반영하고 다음 문제 선택판으로 이동할까요?'
  ))return;

  finalizing=true;
  $('finalizeBtn').disabled=true;

  try{
    await runTransaction(db,async tx=>{
      const gr=ref('games',gid);
      const qr=ref('games',gid,'questions',q.id);

      const trs=ordered.map(t=>
        ref('games',gid,'teams',t.id)
      );

      const [gs,qs,...ts]=await Promise.all([
        tx.get(gr),
        tx.get(qr),
        ...trs.map(r=>tx.get(r))
      ]);

      if(
        gs.data()?.phase!=='closed'||
        gs.data()?.current!==q.id||
        qs.data()?.done
      ){
        throw Error(
          '이미 채점되었거나 진행 상태가 변경되었습니다.'
        );
      }

      ordered.forEach((t,i)=>{
        tx.update(trs[i],{
          score:
            (Number(ts[i].data()?.score)||0)+
            grades[t.id]
        });
      });

      tx.update(qr,{
        done:true,
        grades
      });

      tx.update(
        ref('games',gid,'publicQuestions',q.id),
        {done:true}
      );

      tx.update(gr,{
        phase:'board',
        current:'',
        deadline:null,
        remaining:60,
        paused:false,
        revealedCorrect:'',
        publishedAnswers:{}
      });
    });

    gradingDraft={};
    gradingId='';

    notice(
      '점수 반영 완료. 다음 문제를 선택하세요.'
    );
  }catch(e){
    error(e);
  }finally{
    finalizing=false;
    $('finalizeBtn').disabled=false;
  }
};

// 팀 정보 편집
$('editTeams').onclick=()=>{
  if(!admin)return;

  $('editor').innerHTML=
    '<h3>팀 정보 편집</h3>'+
    sortedTeams().map(t=>`
      <div class="fields">
        <div>
          <label>${esc(t.id)} 팀 이름</label>
          <input
            data-team-name="${t.id}"
            value="${esc(t.name)}"
          >
        </div>
        <div>
          <label>로그인 UID</label>
          <input
            data-team-uid="${t.id}"
            value="${esc(t.uid)}"
          >
        </div>
      </div>
    `).join('')+
    '<p><button id="saveTeams">팀 정보 저장</button></p>';

  $('saveTeams').onclick=async()=>{
    try{
      for(const t of sortedTeams()){
        await updateDoc(
          ref('games',gid,'teams',t.id),
          {
            name:document.querySelector(
              `[data-team-name="${t.id}"]`
            ).value.trim(),
            uid:document.querySelector(
              `[data-team-uid="${t.id}"]`
            ).value.trim()
          }
        );
      }

      notice('팀 정보 저장 완료');
    }catch(e){
      error(e);
    }
  };
};

// 문제 편집
$('editQuestions').onclick=()=>{
  if(!admin)return;

  const ordered=[];

  for(let f=0;f<6;f++){
    for(let l=0;l<3;l++){
      const q=questions.find(
        x=>x.id===qid(f,l)
      );
      if(q)ordered.push(q);
    }
  }

  $('editor').innerHTML=
    '<h3>문제 편집</h3>'+
    '<label>문제 선택</label>'+
    '<select id="qSelect">'+
    ordered.map(q=>`
      <option value="${q.id}">
        ${esc(q.field)} · ${esc(q.level)}
        ${q.done?' (완료)':''}
      </option>
    `).join('')+
    '</select><div id="qFields"></div>';

  const fill=()=>{
    const q=questions.find(
      x=>x.id===$('qSelect').value
    );

    if(!q)return;

    $('qFields').innerHTML=`
      <label>문제 내용</label>
      <textarea id="qText"></textarea>

      <label>정답</label>
      <input id="qCorrect">

      <label>인정할 유사 정답 (줄바꿈 구분)</label>
      <textarea id="qAlt"></textarea>

      <label>배점</label>
      <input id="qPoints" type="number" min="1">

      <label>이미지 URL (선택)</label>
      <input id="qImage">

      <p>
        <button id="saveQ">문제 저장</button>
      </p>
    `;

    $('qText').value=q.text||'';
    $('qCorrect').value=q.correct||'';
    $('qAlt').value=(q.alternatives||[]).join('\n');
    $('qPoints').value=q.points;
    $('qImage').value=q.image||'';

    $('saveQ').onclick=async()=>{
      try{
        if(q.done){
          throw Error(
            '채점 완료 문제는 수정할 수 없습니다.'
          );
        }

        const content={
          text:$('qText').value.trim(),
          correct:$('qCorrect').value.trim(),
          alternatives:
            $('qAlt').value.split('\n')
              .map(x=>x.trim())
              .filter(Boolean),
          points:Number($('qPoints').value),
          image:$('qImage').value.trim()
        };

        if(
          !Number.isFinite(content.points)||
          content.points<=0
        ){
          throw Error('배점을 확인하세요.');
        }

        await updateDoc(
          ref('games',gid,'questions',q.id),
          content
        );

        await updateDoc(
          ref('games',gid,'publicQuestions',q.id),
          {
            text:content.text,
            points:content.points,
            image:content.image
          }
        );

        notice('문제 저장 완료');
      }catch(e){
        error(e);
      }
    };
  };

  $('qSelect').onchange=fill;
  fill();
};

// CSV 결과 다운로드
$('exportBtn').onclick=()=>{
  if(!admin)return;

  const rows=[[
    '분야','난이도','문제',
    '팀','제출답안','획득점수'
  ]];

  for(const q of questions){
    for(const t of sortedTeams()){
      const a=answers.find(x=>
        x.id===`${q.id}_${t.id}`
      );

      rows.push([
        q.field,
        q.level,
        q.text,
        t.name,
        a?.text||'',
        q.grades?.[t.id]??''
      ]);
    }
  }

  rows.push([]);
  rows.push(['최종순위','팀명','누적점수']);

  [...teams]
    .sort((a,b)=>
      (b.score||0)-(a.score||0)
    )
    .forEach((t,i)=>{
      rows.push([
        i+1,
        t.name,
        t.score||0
      ]);
    });

  const csv='\ufeff'+rows.map(r=>
    r.map(v=>
      '"'+String(v??'').replace(/"/g,'""')+'"'
    ).join(',')
  ).join('\r\n');

  const url=URL.createObjectURL(
    new Blob([csv],{
      type:'text/csv;charset=utf-8'
    })
  );

  const a=document.createElement('a');
  a.href=url;
  a.download='퀴즈대회_결과.csv';
  a.click();

  setTimeout(()=>{
    URL.revokeObjectURL(url);
  },1000);
};

// 관리자 설정 열기 / 닫기
$('adminToggle').onclick=()=>{
  if(!admin)return;

  const panel=$('adminPanel');
  const opening=panel.classList.contains('hidden');

  visible('adminPanel',opening);

  $('adminToggle').textContent=opening
    ?'⚙ 관리자 설정 닫기'
    :'⚙ 관리자 설정 열기';

  $('adminToggle').setAttribute(
    'aria-expanded',
    String(opening)
  );

  if(opening){
    panel.scrollIntoView({
      behavior:'smooth',
      block:'start'
    });
  }
};
