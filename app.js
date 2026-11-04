
import { firebaseConfig, ADMIN_UID } from './config.js';

import {
  initializeApp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

import {
  getFirestore,
  doc,
  collection,
  query,
  where,
  onSnapshot,
  getDoc,
  setDoc,
  updateDoc,
  runTransaction,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const $ = id => document.getElementById(id);

const fields = ['경지','인력','노경','안전','환경','WCD'];
const levels = ['하','중','상'];
const points = [50,100,150];
const gid = 'main';

const qid = (f,l) => `${f}-${l}`;

let auth, db;
let user = null;
let admin = false;
let game = {};
let teams = [];
let questions = [];
let answers = [];

let unsubs = [];
let timer = null;
let closing = false;
let gradingDraft = {};
let gradingQuestionId = '';
let submitting = false;
let finalizing = false;

const ref = (...p) => doc(db,...p);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g,c=>({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  }[c]));
}

function note(message) {
  if ($('notice')) $('notice').textContent = message;
}

function err(e) {
  console.error(e);
  note('오류: ' + (e?.message || e));
}

function normalize(value) {
  return String(value ?? '').trim();
}

function currentQ() {
  return questions.find(q => q.id === game.current);
}

function myTeam() {
  return teams.find(t => t.uid === user?.uid);
}

function currentAnswer(teamId) {
  return answers.find(a =>
    a.id === `${game.current}_${teamId}`
  );
}

function autoPercent(answer,q) {
  if (!answer?.text || !q?.correct) return 0;

  return normalize(answer.text) === normalize(q.correct)
    ? 100 : 0;
}

function orderedTeams() {
  return [...teams].sort((a,b) => {
    const ai = Number(a.id?.replace('team','')) || 0;
    const bi = Number(b.id?.replace('team','')) || 0;
    return ai-bi;
  });
}

function remaining() {
  if (game.phase !== 'running') {
    return game.remaining ?? 60;
  }

  if (game.paused) {
    return game.remaining ?? 60;
  }

  const deadline = game.deadline?.toMillis?.();

  if (!deadline) return game.remaining ?? 60;

  return Math.max(
    0,
    Math.ceil((deadline-Date.now())/1000)
  );
}

function setVisible(id,visible) {
  const el = $(id);
  if (el) el.classList.toggle('hidden',!visible);
}

function setText(id,value) {
  const el = $(id);
  if (el) el.textContent = value;
}

// ------------------------------------------------
// Firebase 초기화
// ------------------------------------------------

if (!firebaseConfig?.projectId || !ADMIN_UID) {
  setVisible('setup',true);
  note('Firebase 설정을 확인하세요.');
} else {
  setVisible('setup',false);

  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);

    onAuthStateChanged(auth,handleAuth);
  } catch(e) {
    err(e);
  }
}

if ($('loginBtn')) {
  $('loginBtn').onclick = async () => {
    try {
      await signInWithEmailAndPassword(
        auth,
        $('email').value.trim(),
        $('password').value
      );
    } catch(e) {
      err(e);
    }
  };
}

if ($('logout')) {
  $('logout').onclick = () => signOut(auth);
}

// ------------------------------------------------
// 로그인 및 데이터 구독
// ------------------------------------------------

async function handleAuth(u) {
  unsubs.forEach(fn => fn());
  unsubs = [];

  if (timer) clearInterval(timer);

  user = u;
  admin = !!u && u.uid === ADMIN_UID;

  game = {};
  teams = [];
  questions = [];
  answers = [];

  gradingDraft = {};
  gradingQuestionId = '';
  closing = false;
  finalizing = false;

  setVisible('login',!u);
  setVisible('app',!!u);
  setVisible('logout',!!u);
  setVisible('adminPanel',admin);
  setVisible('adminActions',admin);

  setText(
    'who',
    !u ? '' : admin ? '사회자' : '참가자'
  );

  if (!u) return;

  if (admin) {
    try {
      await initializeGame();
    } catch(e) {
      err(e);
      return;
    }
  }

  unsubs.push(
    onSnapshot(
      ref('games',gid),
      snap => {
        game = snap.data() || {};
        render();
      },
      err
    )
  );

  unsubs.push(
    onSnapshot(
      collection(db,'games',gid,'teams'),
      snap => {
        teams = snap.docs.map(d => ({
          id:d.id,...d.data()
        }));
        render();
      },
      err
    )
  );

  unsubs.push(
    onSnapshot(
      collection(
        db,'games',gid,
        admin ? 'questions' : 'publicQuestions'
      ),
      snap => {
        questions = snap.docs.map(d => ({
          id:d.id,...d.data()
        }));
        render();
      },
      err
    )
  );

  const answerCollection = collection(
    db,'games',gid,'answers'
  );

  unsubs.push(
    onSnapshot(
      admin
        ? answerCollection
        : query(
            answerCollection,
            where('uid','==',u.uid)
          ),
      snap => {
        answers = snap.docs.map(d => ({
          id:d.id,...d.data()
        }));
        render();
      },
      err
    )
  );

  timer = setInterval(renderClock,200);
}

// ------------------------------------------------
// 최초 데이터 생성
// ------------------------------------------------

async function initializeGame() {
  const gr = ref('games',gid);

  if (!(await getDoc(gr)).exists()) {
    await setDoc(gr,{
      phase:'board',
      current:'',
      deadline:null,
      remaining:60,
      paused:false,
      showAnswers:true,
      createdAt:serverTimestamp()
    });
  }

  for (let f=0;f<fields.length;f++) {
    for (let l=0;l<levels.length;l++) {
      const id = qid(f,l);

      const qr = ref('games',gid,'questions',id);
      const pr = ref('games',gid,'publicQuestions',id);

      if (!(await getDoc(qr)).exists()) {
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

      if (!(await getDoc(pr)).exists()) {
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

  for (let i=1;i<=9;i++) {
    const tr = ref('games',gid,'teams',`team${i}`);

    if (!(await getDoc(tr)).exists()) {
      await setDoc(tr,{
        name:`${i}팀`,
        uid:'',
        score:0
      });
    }
  }
}

// ------------------------------------------------
// 문제 선택판
// ------------------------------------------------

function renderBoard() {
  const board = $('board');
  if (!board) return;

  let html = `
    <div style="
      display:grid;
      grid-template-columns:repeat(6,minmax(0,1fr));
      gap:10px;
      width:100%;
    ">
  `;

  for (const f of fields) {
    html += `
      <div style="
        text-align:center;
        color:#f5c65e;
        font-weight:bold;
        padding:12px 4px;
        font-size:clamp(12px,1.5vw,20px);
      ">${f}</div>
    `;
  }

  for (let li=0;li<levels.length;li++) {
    for (let fi=0;fi<fields.length;fi++) {
      const id = qid(fi,li);
      const q = questions.find(x => x.id === id);

      const done = !!q?.done;
      const disabled =
        !admin || done || game.phase !== 'board';

      const bg = done ? '#183c32' : '#203d66';
      const fg = done ? '#80e0a9' : '#ffffff';
      const border = done ? '#39795c' : '#5276a5';

      html += `
        <button
          type="button"
          data-q="${id}"
          ${disabled ? 'disabled' : ''}
          style="
            min-width:0;
            min-height:105px;
            border:1px solid ${border};
            border-radius:12px;
            background:${bg};
            color:${fg};
            font-size:clamp(15px,1.7vw,23px);
            font-weight:bold;
            cursor:${disabled ? 'default' : 'pointer'};
            opacity:${done ? '.6' : '1'};
          "
        >
          ${done ? '✓' : `${q?.points ?? points[li]}점`}
          <div style="
            font-size:13px;
            margin-top:8px;
          ">
            ${done ? '완료' : levels[li]}
          </div>
        </button>
      `;
    }
  }

  html += '</div>';

  board.innerHTML = html;

  board.querySelectorAll('[data-q]').forEach(btn => {
    btn.onclick = () => choose(btn.dataset.q);
  });

  setText(
    'counter',
    `${questions.filter(q=>q.done).length} / 18`
  );
}

// ------------------------------------------------
// 순위표
// ------------------------------------------------

function renderRanking() {
  const target = $('ranking');
  if (!target) return;

  const sorted = [...teams].sort((a,b) =>
    (b.score||0)-(a.score||0) ||
    String(a.name).localeCompare(String(b.name),'ko')
  );

  let previousScore = null;
  let rank = 0;

  target.innerHTML = sorted.map((t,i) => {
    const score = Number(t.score)||0;

    if (previousScore !== score) {
      rank = i+1;
      previousScore = score;
    }

    return `
      <div class="rank">
        <span>
          ${rank}위　${escapeHtml(t.name)}
        </span>
        <strong>${score}점</strong>
      </div>
    `;
  }).join('');
}

// ------------------------------------------------
// 전체 화면
// ------------------------------------------------

function render() {
  if (!user) return;

  renderBoard();
  renderRanking();

  const q = currentQ();

  const boardPhase = game.phase === 'board';
  const ready = game.phase === 'ready';
  const running = game.phase === 'running';
  const closed = game.phase === 'closed';

  setVisible('active',!!q && !boardPhase);

  if (boardPhase || !q) {
    setText('phaseLabel','문제 선택판');
    setVisible('grading',false);
    return;
  }

  setText(
    'questionMeta',
    `${q.field} · ${q.level} · ${q.points}점`
  );

  setText(
    'questionText',
    q.text || '(문제 미등록)'
  );

  const image = $('questionImage');

  if (image) {
    image.innerHTML = q.image
      ? `<img src="${escapeHtml(q.image)}"
          alt="문제 이미지"
          style="max-width:100%;max-height:350px;
          object-fit:contain">`
      : '';
  }

  const count = teams.filter(
    t => !!currentAnswer(t.id)
  ).length;

  setText(
    'submitCount',
    `답안 제출 ${count} / 9팀`
  );

  const mine = myTeam();

  setVisible(
    'teamAnswer',
    !admin && !!mine && running
  );

  if ($('submitBtn')) {
    $('submitBtn').disabled =
      !running ||
      !!game.paused ||
      remaining()<=0 ||
      submitting;
  }

  if (mine && $('answerInput')) {
    if (document.activeElement !== $('answerInput')) {
      $('answerInput').value =
        currentAnswer(mine.id)?.text || '';
    }
  }

  // 사회자 화면에서만 채점표 표시
  setVisible('grading',admin && closed);

  // 문제 진행 중에는 정답 비공개
  setVisible('reveal',closed);

  if (closed) {
    setText(
      'correctText',
      admin
        ? (q.correct || '')
        : (game.revealedCorrect || '')
    );

    // 기존 중복 답안 목록 제거
    if ($('allAnswers')) {
      $('allAnswers').innerHTML = '';
    }
  }

  // 채점 중에는 문제 본문보다 채점표 우선
  setVisible('questionText',!(closed && admin));
  setVisible('questionImage',!(closed && admin));
  setVisible('submitCount',!(closed && admin));
  setVisible('clock',!(closed && admin));

  if (admin) {
    if ($('startBtn')) {
      $('startBtn').disabled =
        !ready || !q.text || !q.correct;
    }

    if ($('closeBtn')) {
      $('closeBtn').disabled = !running;
    }

    if ($('pauseBtn')) {
      $('pauseBtn').disabled =
        !running || !!game.paused;
    }

    if ($('resumeBtn')) {
      $('resumeBtn').disabled =
        !running || !game.paused;
    }

    setText(
      'adminHint',
      ready
        ? '문제를 확인한 후 60초 시작을 누르세요.'
        : running
        ? '시간 종료 시 자동으로 채점 화면으로 전환됩니다.'
        : closed
        ? '채점 후 점수 반영 및 다음 문제를 누르세요.'
        : ''
    );

    if (closed) renderGrades(q);
  }

  renderClock();
}

// ------------------------------------------------
// 타이머
// ------------------------------------------------

function renderClock() {
  if (!user) return;

  const r = remaining();

  setText(
    'clock',
    `${String(Math.floor(r/60)).padStart(2,'0')}:`+
    `${String(r%60).padStart(2,'0')}`
  );

  if (
    admin &&
    game.phase === 'running' &&
    !game.paused &&
    r === 0 &&
    !closing
  ) {
    closing = true;

    closeQuestion().finally(() => {
      closing = false;
    });
  }
}

// ------------------------------------------------
// 문제 선택
// ------------------------------------------------

async function choose(id) {
  if (!admin || game.phase !== 'board') return;

  const q = questions.find(x=>x.id===id);

  if (!q || q.done) return;

  try {
    await updateDoc(ref('games',gid),{
      current:id,
      phase:'ready',
      deadline:null,
      remaining:60,
      paused:false,
      revealedCorrect:'',
      publishedAnswers:{}
    });
  } catch(e) {
    err(e);
  }
}

// ------------------------------------------------
// 60초 시작
// ------------------------------------------------

if ($('startBtn')) {
  $('startBtn').onclick = async () => {
    if (!admin || game.phase !== 'ready') return;

    const q = currentQ();

    if (!q?.text || !q?.correct) {
      note('문제와 정답을 먼저 등록하세요.');
      return;
    }

    try {
      await updateDoc(ref('games',gid),{
        phase:'running',
        deadline:new Date(Date.now()+60000),
        remaining:60,
        paused:false
      });
    } catch(e) {
      err(e);
    }
  };
}

// ------------------------------------------------
// 문제 마감
// ------------------------------------------------

async function closeQuestion() {
  if (!admin || game.phase !== 'running') return;

  try {
    const q = currentQ();

    await updateDoc(ref('games',gid),{
      phase:'closed',
      remaining:0,
      paused:false,
      revealedCorrect:q?.correct || '',
      publishedAnswers:Object.fromEntries(
        teams.map(t=>[
          t.id,
          currentAnswer(t.id)?.text || ''
        ])
      )
    });
  } catch(e) {
    err(e);
  }
}

if ($('closeBtn')) {
  $('closeBtn').onclick = closeQuestion;
}

// ------------------------------------------------
// 일시정지 / 재개
// ------------------------------------------------

if ($('pauseBtn')) {
  $('pauseBtn').onclick = async () => {
    if (!admin || game.phase !== 'running') return;

    try {
      await updateDoc(ref('games',gid),{
        paused:true,
        remaining:remaining()
      });
    } catch(e) {
      err(e);
    }
  };
}

if ($('resumeBtn')) {
  $('resumeBtn').onclick = async () => {
    if (
      !admin ||
      game.phase !== 'running' ||
      !game.paused
    ) return;

    try {
      await updateDoc(ref('games',gid),{
        paused:false,
        deadline:new Date(
          Date.now()+(game.remaining||0)*1000
        )
      });
    } catch(e) {
      err(e);
    }
  };
}

// ------------------------------------------------
// 참가자 답안 제출
// ------------------------------------------------

if ($('submitBtn')) {
  $('submitBtn').onclick = async () => {
    const t = myTeam();
    const text = $('answerInput')?.value.trim();

    if (!t || !text) {
      note('답안을 입력하세요.');
      return;
    }

    if (submitting) return;

    submitting = true;
    $('submitBtn').disabled = true;

    try {
      const gr = ref('games',gid);
      const ar = ref(
        'games',gid,'answers',
        `${game.current}_${t.id}`
      );

      await runTransaction(db,async tx => {
        const gs = await tx.get(gr);
        const s = gs.data();

        if (
          s.phase !== 'running' ||
          s.paused ||
          !s.deadline ||
          s.deadline.toMillis() <= Date.now()
        ) {
          throw Error('제출 시간이 종료되었습니다.');
        }

        tx.set(ar,{
          teamId:t.id,
          questionId:s.current,
          text,
          submittedAt:serverTimestamp(),
          uid:user.uid
        });
      });

      setText('submitMsg','제출 완료');
      note('답안이 저장되었습니다.');
    } catch(e) {
      err(e);
    } finally {
      submitting = false;
      render();
    }
  };
}

// ------------------------------------------------
// 채점 화면
// ------------------------------------------------

function renderGrades(q) {
  const target = $('gradingRows');
  if (!target) return;

  if (gradingQuestionId !== q.id) {
    gradingQuestionId = q.id;
    gradingDraft = {};
  }

  const ordered = orderedTeams();

  target.innerHTML = ordered.map(t => {
    const a = currentAnswer(t.id);

    const initial = autoPercent(a,q);
    const pct = gradingDraft[t.id] ?? initial;

    const answerText = a?.text
      ? escapeHtml(a.text)
      : '<span style="color:#94a3b8">미제출</span>';

    return `
      <div class="answer" style="
        display:grid;
        grid-template-columns:
          minmax(65px,100px)
          minmax(0,1fr)
          auto;
        gap:12px;
        align-items:center;
        padding:9px 0;
        border-bottom:1px solid #31435e;
      ">
        <strong>${escapeHtml(t.name)}</strong>

        <span style="
          overflow-wrap:anywhere;
          font-size:16px;
        ">
          ${answerText}
        </span>

        <div style="display:flex;gap:4px">
          ${[100,50,0].map(p => {
            const selected = pct === p;

            return `
              <button
                type="button"
                data-team-grade="${escapeHtml(t.id)}"
                data-pct="${p}"
                ${!a?.text ? 'disabled' : ''}
                style="
                  min-width:50px;
                  padding:9px 7px;
                  border:1px solid
                    ${selected?'#6da5ff':'#405573'};
                  border-radius:7px;
                  background:
                    ${selected?'#397cf0':'#263a58'};
                  color:
                    ${selected?'white':'#c7d5e8'};
                  font-weight:
                    ${selected?'bold':'normal'};
                  cursor:pointer;
                "
              >
                ${p}%
              </button>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');

  target.querySelectorAll(
    '[data-team-grade]'
  ).forEach(btn => {
    btn.onclick = () => {
      gradingDraft[btn.dataset.teamGrade] =
        Number(btn.dataset.pct);

      renderGrades(q);
    };
  });

  if ($('finalizeBtn')) {
    $('finalizeBtn').textContent =
      '점수 반영 및 다음 문제';

    $('finalizeBtn').disabled = finalizing;
  }
}

// ------------------------------------------------
// 채점 확정 및 문제 선택판 복귀
// ------------------------------------------------

if ($('finalizeBtn')) {
  $('finalizeBtn').onclick = async () => {
    if (
      !admin ||
      game.phase !== 'closed' ||
      finalizing
    ) return;

    const q = currentQ();
    if (!q) return;

    const ordered = orderedTeams();

    const grades = Object.fromEntries(
      ordered.map(t => {
        const a = currentAnswer(t.id);

        const pct = a?.text
          ? (gradingDraft[t.id] ?? autoPercent(a,q))
          : 0;

        return [
          t.id,
          Number(q.points)*pct/100
        ];
      })
    );

    if (!confirm(
      '9팀 점수를 반영하고 다음 문제 선택판으로 이동할까요?'
    )) return;

    finalizing = true;
    $('finalizeBtn').disabled = true;

    try {
      await runTransaction(db,async tx => {
        const gr = ref('games',gid);
        const qr = ref(
          'games',gid,'questions',q.id
        );

        const teamRefs = ordered.map(t =>
          ref('games',gid,'teams',t.id)
        );

        // Firestore 트랜잭션은 읽기를 먼저 완료해야 함
        const snapshots = await Promise.all([
          tx.get(gr),
          tx.get(qr),
          ...teamRefs.map(r=>tx.get(r))
        ]);

        const [gs,qs,...ts] = snapshots;

        if (
          gs.data()?.phase !== 'closed' ||
          gs.data()?.current !== q.id ||
          qs.data()?.done
        ) {
          throw Error(
            '이미 채점되었거나 진행 상태가 변경되었습니다.'
          );
        }

        ordered.forEach((t,i) => {
          tx.update(teamRefs[i],{
            score:
              (Number(ts[i].data()?.score)||0) +
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

      gradingDraft = {};
      gradingQuestionId = '';

      note(
        '점수 반영 완료. 다음 문제를 선택하세요.'
      );
    } catch(e) {
      err(e);
    } finally {
      finalizing = false;
      $('finalizeBtn').disabled = false;
    }
  };
}

// ------------------------------------------------
// 관리자: 팀 정보 편집
// ------------------------------------------------

if ($('editTeams')) {
  $('editTeams').onclick = () => {
    if (!admin) return;

    $('editor').innerHTML =
      '<h3>팀 정보 편집</h3>' +
      orderedTeams().map(t => `
        <div class="fields">
          <div>
            <label>${escapeHtml(t.id)} 팀 이름</label>
            <input
              data-team-name="${escapeHtml(t.id)}"
              value="${escapeHtml(t.name)}"
            >
          </div>
          <div>
            <label>로그인 UID</label>
            <input
              data-team-uid="${escapeHtml(t.id)}"
              value="${escapeHtml(t.uid)}"
            >
          </div>
        </div>
      `).join('') +
      '<p><button id="saveTeams">팀 정보 저장</button></p>';

    $('saveTeams').onclick = async () => {
      try {
        for (const t of orderedTeams()) {
          const name = document.querySelector(
            `[data-team-name="${t.id}"]`
          ).value.trim();

          const uid = document.querySelector(
            `[data-team-uid="${t.id}"]`
          ).value.trim();

          await updateDoc(
            ref('games',gid,'teams',t.id),
            {name,uid}
          );
        }

        note('팀 정보 저장 완료');
      } catch(e) {
        err(e);
      }
    };
  };
}

// ------------------------------------------------
// 관리자: 18문제 편집
// ------------------------------------------------

if ($('editQuestions')) {
  $('editQuestions').onclick = () => {
    if (!admin) return;

    const ordered = [];

    for (let f=0;f<6;f++) {
      for (let l=0;l<3;l++) {
        const q = questions.find(
          x=>x.id===qid(f,l)
        );
        if (q) ordered.push(q);
      }
    }

    $('editor').innerHTML = `
      <h3>문제 편집</h3>
      <label>문제 선택</label>
      <select id="qSelect">
        ${ordered.map(q=>`
          <option value="${escapeHtml(q.id)}">
            ${escapeHtml(q.field)} ·
            ${escapeHtml(q.level)}
            ${q.done?'(완료)':''}
          </option>
        `).join('')}
      </select>
      <div id="qFields"></div>
    `;

    const fill = () => {
      const q = questions.find(
        x=>x.id===$('qSelect').value
      );

      if (!q) return;

      $('qFields').innerHTML = `
        <label>문제 내용</label>
        <textarea id="qText"></textarea>

        <label>정답</label>
        <input id="qCorrect">

        <label>인정할 유사 정답 (줄바꿈 구분)</label>
        <textarea id="qAlt"></textarea>

        <label>배점</label>
        <input
          id="qPoints"
          type="number"
          min="1"
        >

        <label>이미지 URL (선택)</label>
        <input id="qImage">

        <p>
          <button id="saveQ">문제 저장</button>
        </p>
      `;

      $('qText').value = q.text||'';
      $('qCorrect').value = q.correct||'';
      $('qAlt').value =
        (q.alternatives||[]).join('\n');
      $('qPoints').value = q.points;
      $('qImage').value = q.image||'';

      $('saveQ').onclick = async () => {
        try {
          if (q.done) {
            throw Error(
              '채점 완료 문제는 수정할 수 없습니다.'
            );
          }

          const text = $('qText').value.trim();
          const correct =
            $('qCorrect').value.trim();
          const points =
            Number($('qPoints').value);
          const image =
            $('qImage').value.trim();

          if (
            !Number.isFinite(points) ||
            points<=0
          ) {
            throw Error('배점을 확인하세요.');
          }

          await updateDoc(
            ref('games',gid,'questions',q.id),
            {
              text,
              correct,
              alternatives:
                $('qAlt').value.split('\n')
                  .map(x=>x.trim())
                  .filter(Boolean),
              points,
              image
            }
          );

          await updateDoc(
            ref(
              'games',gid,'publicQuestions',q.id
            ),
            {
              text,
              points,
              image
            }
          );

          note('문제 저장 완료');
        } catch(e) {
          err(e);
        }
      };
    };

    $('qSelect').onchange = fill;
    fill();
  };
}

// ------------------------------------------------
// 결과 CSV 다운로드
// ------------------------------------------------

if ($('exportBtn')) {
  $('exportBtn').onclick = () => {
    if (!admin) return;

    const rows = [[
      '분야','난이도','문제',
      '팀','제출답안','획득점수'
    ]];

    for (const q of questions) {
      for (const t of orderedTeams()) {
        const a = answers.find(x =>
          x.id === `${q.id}_${t.id}`
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

    const csv = '\ufeff'+rows.map(row =>
      row.map(v =>
        '"'+String(v??'').replace(/"/g,'""')+'"'
      ).join(',')
    ).join('\r\n');

    const blob = new Blob([csv],{
      type:'text/csv;charset=utf-8'
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = '퀴즈대회_결과.csv';
    a.click();

    setTimeout(()=>{
      URL.revokeObjectURL(url);
    },1000);
  };
}
