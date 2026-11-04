
import {firebaseConfig,ADMIN_UID} from './config.js';
import {initializeApp} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth,onAuthStateChanged,signInWithEmailAndPassword,signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore,doc,collection,query,where,onSnapshot,
  getDoc,setDoc,updateDoc,runTransaction,serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const $=id=>document.getElementById(id);
const fields=['경지','인력','노경','안전','환경','WCD'];
const levels=['하','중','상'];
const pts=[50,100,150];
const gid='main';

const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;',
  '"':'&quot;',"'":'&#39;'
}[c]));

const qid=(f,l)=>`${f}-${l}`;

let auth,db,user=null,admin=false;
let game={},teams=[],questions=[],answers=[];
let unsubs=[],timer=null,closing=false;
let gradingDraft={},gradingQuestionId='';

const ref=(...p)=>doc(db,...p);
const note=s=>{$('notice').textContent=s};
const err=e=>note('오류: '+(e.message||e));

function normalize(s){
  return String(s??'').trim();
}

function currentQ(){
  return questions.find(q=>q.id===game.current);
}

function myTeam(){
  return teams.find(t=>t.uid===user?.uid);
}

function currentAnswer(tid){
  return answers.find(a=>a.id===`${game.current}_${tid}`);
}

function autoPercent(a,q){
  if(!a?.text||!q?.correct)return 0;
  return normalize(a.text)===normalize(q.correct)?100:0;
}

if(!firebaseConfig.projectId||!ADMIN_UID){
  $('setup').classList.remove('hidden');
  note('Firebase 설정을 확인하세요.');
}else{
  $('setup').classList.add('hidden');
  try{
    const app=initializeApp(firebaseConfig);
    auth=getAuth(app);
    db=getFirestore(app);
    onAuthStateChanged(auth,handleAuth);
  }catch(e){err(e)}
}

$('loginBtn').onclick=async()=>{
  try{
    await signInWithEmailAndPassword(
      auth,$('email').value.trim(),$('password').value
    );
  }catch(e){err(e)}
};

$('logout').onclick=()=>signOut(auth);

async function handleAuth(u){
  unsubs.forEach(f=>f());
  unsubs=[];
  clearInterval(timer);

  user=u;
  admin=!!u&&u.uid===ADMIN_UID;
  game={};teams=[];questions=[];answers=[];
  gradingDraft={};gradingQuestionId='';

  $('login').classList.toggle('hidden',!!u);
  $('app').classList.toggle('hidden',!u);
  $('logout').classList.toggle('hidden',!u);
  $('who').textContent=u
    ?(admin?'사회자':`참가자 UID: ${u.uid}`):'';

  if(!u)return;

  if(admin){
    try{
      const gr=ref('games',gid);
      if(!(await getDoc(gr)).exists()){
        await setDoc(gr,{
          phase:'board',current:'',deadline:null,
          remaining:60,paused:false,showAnswers:true,
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
              field:fields[f],level:levels[l],
              points:pts[l],text:'',correct:'',
              alternatives:[],image:'',done:false
            });
          }

          if(!(await getDoc(pr)).exists()){
            await setDoc(pr,{
              field:fields[f],level:levels[l],
              points:pts[l],text:'',image:'',done:false
            });
          }
        }
      }

      for(let i=1;i<=9;i++){
        const r=ref('games',gid,'teams',`team${i}`);
        if(!(await getDoc(r)).exists()){
          await setDoc(r,{name:`${i}팀`,uid:'',score:0});
        }
      }
    }catch(e){err(e)}
  }

  unsubs.push(onSnapshot(ref('games',gid),s=>{
    game=s.data()||{};
    render();
  },err));

  unsubs.push(onSnapshot(
    collection(db,'games',gid,'teams'),
    s=>{
      teams=s.docs.map(d=>({id:d.id,...d.data()}));
      render();
    },err
  ));

  unsubs.push(onSnapshot(
    collection(db,'games',gid,admin?'questions':'publicQuestions'),
    s=>{
      questions=s.docs.map(d=>({id:d.id,...d.data()}));
      render();
    },err
  ));

  const answerPath=collection(db,'games',gid,'answers');
  unsubs.push(onSnapshot(
    admin?answerPath:query(answerPath,where('uid','==',u.uid)),
    s=>{
      answers=s.docs.map(d=>({id:d.id,...d.data()}));
      render();
    },err
  ));

  $('adminPanel').classList.toggle('hidden',!admin);
  $('adminActions').classList.toggle('hidden',!admin);

  timer=setInterval(renderClock,200);
}

function remaining(){
  if(game.phase!=='running')return game.remaining??60;
  if(game.paused)return game.remaining??60;
  const deadline=game.deadline?.toMillis?.();
  if(!deadline)return 60;
  return Math.max(0,Math.ceil((deadline-Date.now())/1000));
}

function renderClock(){
  if(!user)return;

  const r=remaining();
  $('clock').textContent=
    `${String(Math.floor(r/60)).padStart(2,'0')}:`+
    `${String(r%60).padStart(2,'0')}`;

  if(admin&&game.phase==='running'&&!game.paused&&
     r===0&&!closing){
    closing=true;
    closeQuestion().finally(()=>closing=false);
  }
}

function render(){
  if(!user)return;

  const q=currentQ();
  const closed=game.phase==='closed';
  const running=game.phase==='running';
  const ready=game.phase==='ready';

  $('counter').textContent=
    `${questions.filter(x=>x.done).length} / 18`;

  $('phaseLabel').textContent='문제 선택판';

  $('board').innerHTML=
    fields.map(f=>`<div class="tile headtile">${f}</div>`).join('')+
    levels.map((l,li)=>fields.map((f,fi)=>{
      const id=qid(fi,li);
      const x=questions.find(q=>q.id===id);
      const disabled=!admin||x?.done||game.phase!=='board';
      return `<button class="tile" data-q="${id}"
        ${disabled?'disabled':''}>
        ${x?.done?'✓':(x?.points??pts[li])+'점'}
        <br><small>${l}</small>
      </button>`;
    }).join('')).join('');

  document.querySelectorAll('[data-q]').forEach(b=>{
    b.onclick=()=>choose(b.dataset.q);
  });

  const sorted=[...teams].sort((a,b)=>
    (b.score||0)-(a.score||0)||
    a.name.localeCompare(b.name)
  );

  let rank=0,prev=null;
  $('ranking').innerHTML=sorted.map((t,i)=>{
    if(t.score!==prev){
      rank=i+1;prev=t.score;
    }
    return `<div class="rank">
      <span>${rank}위　${escapeHtml(t.name)}</span>
      <strong>${t.score||0}점</strong>
    </div>`;
  }).join('');

  $('active').classList.toggle(
    'hidden',!q||game.phase==='board'
  );

  if(!q)return;

  $('questionMeta').textContent=
    `${q.field} · ${q.level} · ${q.points}점`;

  $('questionText').textContent=q.text||'(문제 미등록)';

  $('questionImage').innerHTML=q.image
    ?`<img src="${escapeHtml(q.image)}" alt="문제 이미지">`
    :'';

  const count=teams.filter(t=>currentAnswer(t.id)).length;
  $('submitCount').textContent=`제출 완료 ${count} / 9팀`;

  const mine=myTeam();
  $('teamAnswer').classList.toggle(
    'hidden',admin||!mine||!running
  );

  $('submitBtn').disabled=
    !running||game.paused||remaining()<=0;

  if(mine&&document.activeElement!==$('answerInput')){
    $('answerInput').value=currentAnswer(mine.id)?.text||'';
  }

  $('reveal').classList.toggle('hidden',!closed);

  if(closed){
    $('correctText').textContent=
      game.revealedCorrect||(admin?q.correct:'')||'';

    // 채점표에서 팀별 답안을 표시하므로 중복 목록은 숨김
    $('allAnswers').innerHTML='';
  }

  if(admin){
    $('startBtn').disabled=!ready||!q.text||!q.correct;
    $('closeBtn').disabled=!running;
    $('pauseBtn').disabled=!running||game.paused;
    $('resumeBtn').disabled=!running||!game.paused;

    $('grading').classList.toggle('hidden',!closed);

    $('adminHint').textContent=ready
      ?'문제를 확인한 후 60초 시작을 누르세요.'
      :running
      ?'시간이 종료되면 자동으로 채점 화면으로 전환됩니다.'
      :closed
      ?'팀별 점수를 선택한 후 점수 반영 및 다음 문제를 누르세요.'
      :'';

    if(closed){
      renderGrades(q);
    }
  }

  // 채점 단계에서는 문제를 숨기고 채점표를 중심으로 표시
  $('questionText').classList.toggle('hidden',closed&&admin);
  $('questionImage').classList.toggle('hidden',closed&&admin);
  $('submitCount').classList.toggle('hidden',closed&&admin);
  $('clock').classList.toggle('hidden',closed&&admin);

  renderClock();
}

async function choose(id){
  if(!admin||game.phase!=='board')return;
  try{
    await updateDoc(ref('games',gid),{
      current:id,phase:'ready',
      remaining:60,paused:false,
      revealedCorrect:'',publishedAnswers:{}
    });
  }catch(e){err(e)}
}

$('startBtn').onclick=async()=>{
  try{
    await updateDoc(ref('games',gid),{
      phase:'running',
      deadline:new Date(Date.now()+60000),
      remaining:60,paused:false
    });
  }catch(e){err(e)}
};

async function closeQuestion(){
  if(!admin||game.phase!=='running')return;
  try{
    await updateDoc(ref('games',gid),{
      phase:'closed',
      remaining:0,paused:false,
      revealedCorrect:currentQ()?.correct||'',
      publishedAnswers:Object.fromEntries(
        teams.map(t=>[t.id,currentAnswer(t.id)?.text||''])
      )
    });
  }catch(e){err(e)}
}

$('closeBtn').onclick=closeQuestion;

$('pauseBtn').onclick=async()=>{
  try{
    await updateDoc(ref('games',gid),{
      paused:true,remaining:remaining()
    });
  }catch(e){err(e)}
};

$('resumeBtn').onclick=async()=>{
  try{
    await updateDoc(ref('games',gid),{
      paused:false,
      deadline:new Date(Date.now()+(game.remaining||0)*1000)
    });
  }catch(e){err(e)}
};

$('submitBtn').onclick=async()=>{
  const t=myTeam();
  const text=$('answerInput').value.trim();

  if(!t||!text){
    note('답안을 입력하세요.');
    return;
  }

  try{
    const gr=ref('games',gid);
    const ar=ref('games',gid,'answers',
      `${game.current}_${t.id}`);

    await runTransaction(db,async tx=>{
      const snap=await tx.get(gr);
      const s=snap.data();

      if(s.phase!=='running'||s.paused||
         !s.deadline||
         s.deadline.toMillis()<=Date.now()){
        throw Error('제출 시간이 종료되었습니다.');
      }

      tx.set(ar,{
        teamId:t.id,questionId:s.current,
        text,submittedAt:serverTimestamp(),
        uid:user.uid
      });
    });

    $('submitMsg').textContent='제출 완료';
    note('답안이 저장되었습니다.');
  }catch(e){err(e)}
};

function renderGrades(q){
  if(gradingQuestionId!==q.id){
    gradingQuestionId=q.id;
    gradingDraft={};
  }

  $('gradingRows').innerHTML=teams.map(t=>{
    const a=currentAnswer(t.id);
    const initial=autoPercent(a,q);
    const pct=gradingDraft[t.id]??initial;

    return `<div class="answer"
      style="display:grid;grid-template-columns:85px minmax(0,1fr) auto;gap:10px">
      <strong>${escapeHtml(t.name)}</strong>
      <span>${escapeHtml(a?.text||'미제출')}</span>
      <div style="display:flex;gap:4px">
        ${[100,50,0].map(p=>`
          <button type="button"
            data-team-grade="${escapeHtml(t.id)}"
            data-pct="${p}"
            ${!a?.text?'disabled':''}
            style="padding:9px 10px;background:${pct===p?'#397cf0':'#415672'}">
            ${p}%
          </button>
        `).join('')}
      </div>
    </div>`;
  }).join('');

  document.querySelectorAll('[data-team-grade]').forEach(btn=>{
    btn.onclick=()=>{
      gradingDraft[btn.dataset.teamGrade]=Number(btn.dataset.pct);
      renderGrades(q);
    };
  });

  $('finalizeBtn').textContent='점수 반영 및 다음 문제';
}

$('finalizeBtn').onclick=async()=>{
  if(!admin||game.phase!=='closed')return;
  const q=currentQ();
  if(!q)return;

  const grades=Object.fromEntries(teams.map(t=>{
    const a=currentAnswer(t.id);
    const pct=a?.text
      ?(gradingDraft[t.id]??autoPercent(a,q))
      :0;
    return [t.id,Number(q.points)*pct/100];
  }));

  if(!confirm(
    '9팀 점수를 반영하고 다음 문제 선택판으로 이동할까요?'
  ))return;

  $('finalizeBtn').disabled=true;

  try{
    await runTransaction(db,async tx=>{
      const gr=ref('games',gid);
      const qr=ref('games',gid,'questions',q.id);

      const [gs,qs,...ts]=await Promise.all([
        tx.get(gr),tx.get(qr),
        ...teams.map(t=>
          tx.get(ref('games',gid,'teams',t.id))
        )
      ]);

      if(gs.data().phase!=='closed'||qs.data().done){
        throw Error('이미 채점되었거나 진행 상태가 변경되었습니다.');
      }

      teams.forEach((t,i)=>{
        tx.update(ref('games',gid,'teams',t.id),{
          score:(ts[i].data().score||0)+grades[t.id]
        });
      });

      tx.update(qr,{done:true,grades});
      tx.update(ref('games',gid,'publicQuestions',q.id),{
        done:true
      });
      tx.update(gr,{
        phase:'board',current:'',
        remaining:60,paused:false,
        revealedCorrect:'',publishedAnswers:{}
      });
    });

    gradingDraft={};
    gradingQuestionId='';
    note('점수 반영 완료. 다음 문제를 선택하세요.');
  }catch(e){
    err(e);
  }finally{
    $('finalizeBtn').disabled=false;
  }
};

$('editTeams').onclick=()=>{
  if(!admin)return;

  $('editor').innerHTML=
    '<h3>팀 이름 및 UID</h3>'+
    [...teams].sort((a,b)=>a.id.localeCompare(b.id))
    .map(t=>`<div class="fields">
      <div>
        <label>${t.id} 팀 이름</label>
        <input data-team-name="${t.id}"
          value="${escapeHtml(t.name)}">
      </div>
      <div>
        <label>로그인 UID</label>
        <input data-team-uid="${t.id}"
          value="${escapeHtml(t.uid)}">
      </div>
    </div>`).join('')+
    '<p><button id="saveTeams">팀 정보 저장</button></p>';

  $('saveTeams').onclick=async()=>{
    try{
      for(const t of teams){
        await updateDoc(ref('games',gid,'teams',t.id),{
          name:document.querySelector(
            `[data-team-name="${t.id}"]`
          ).value.trim(),
          uid:document.querySelector(
            `[data-team-uid="${t.id}"]`
          ).value.trim()
        });
      }
      note('팀 정보 저장 완료');
    }catch(e){err(e)}
  };
};

$('editQuestions').onclick=()=>{
  if(!admin)return;

  $('editor').innerHTML=
    '<h3>문제 편집</h3><label>문제 선택</label>'+
    '<select id="qSelect">'+
    [...questions].sort((a,b)=>a.id.localeCompare(b.id))
    .map(q=>`<option value="${q.id}">
      ${q.field} · ${q.level}
    </option>`).join('')+
    '</select><div id="qFields"></div>';

  const fill=()=>{
    const q=questions.find(x=>x.id===$('qSelect').value);

    $('qFields').innerHTML=`
      <label>문제</label><textarea id="qText"></textarea>
      <label>정답</label><input id="qCorrect">
      <label>인정할 유사 정답 (줄바꿈으로 구분)</label>
      <textarea id="qAlt"></textarea>
      <label>배점</label>
      <input id="qPoints" type="number" min="1">
      <label>이미지 URL (선택)</label>
      <input id="qImage">
      <p><button id="saveQ">문제 저장</button></p>`;

    $('qText').value=q.text||'';
    $('qCorrect').value=q.correct||'';
    $('qAlt').value=(q.alternatives||[]).join('\n');
    $('qPoints').value=q.points;
    $('qImage').value=q.image||'';

    $('saveQ').onclick=async()=>{
      try{
        if(q.done){
          throw Error('채점 완료 문제는 수정할 수 없습니다.');
        }

        const text=$('qText').value.trim();
        const correct=$('qCorrect').value.trim();
        const points=Number($('qPoints').value);
        const image=$('qImage').value.trim();

        if(!Number.isFinite(points)||points<=0){
          throw Error('배점을 확인하세요.');
        }

        await updateDoc(ref('games',gid,'questions',q.id),{
          text,correct,
          alternatives:$('qAlt').value.split('\n')
            .map(x=>x.trim()).filter(Boolean),
          points,image
        });

        await updateDoc(
          ref('games',gid,'publicQuestions',q.id),
          {text,points,image}
        );

        note('문제 저장 완료');
      }catch(e){err(e)}
    };
  };

  $('qSelect').onchange=fill;
  fill();
};

$('exportBtn').onclick=()=>{
  const rows=[[
    '분야','난이도','문제','팀','제출답안','점수'
  ]];

  for(const q of questions){
    for(const t of teams){
      const a=answers.find(x=>x.id===`${q.id}_${t.id}`);
      rows.push([
        q.field,q.level,q.text,t.name,
        a?.text||'',q.grades?.[t.id]??''
      ]);
    }
  }

  rows.push([]);
  rows.push(['최종순위','팀명','누적점수']);

  [...teams].sort((a,b)=>(b.score||0)-(a.score||0))
    .forEach((t,i)=>rows.push([i+1,t.name,t.score||0]));

  const csv='\ufeff'+rows.map(r=>
    r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"')
      .join(',')
  ).join('\r\n');

  const a=document.createElement('a');
  const url=URL.createObjectURL(
    new Blob([csv],{type:'text/csv;charset=utf-8'})
  );

  a.href=url;
  a.download='퀴즈대회_결과.csv';
  a.click();

  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
