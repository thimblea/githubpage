'use strict';
const L = window.MealLogic;
const STORE = 'flavormate-v2';
const MEALS = ['早餐','午餐','晚餐'];
const CATEGORIES = ['蔬菜水果','肉蛋水产','主食杂粮','豆奶制品','调味品','其他'];
const today = L.dateKey(new Date());
const main = document.querySelector('main');
const dialog = document.querySelector('#plan-dialog');
const recipeDialog = document.querySelector('#recipe-dialog');
let builtInRecipes = [], recipes = [], results = null, recipeFilter = '全部', query = '', portions = {}, storageProblem = false;
let pendingPlan = null, editorRow = 0;
let toastTimeout, lastRoute = '', timerAnnounced = '';
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2);
const validDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && L.dateKey(L.parseDate(v)) === v;
const validNumber = (v,max) => Number.isFinite(v) && v > 0 && v <= max;
function freshState() { return {week:L.monday(),plans:[],custom:[],userRecipes:[],checked:{},cook:{},portions:{},filters:{ingredients:'鸡胸肉、西兰花',goal:'均衡',avoid:'',flavor:'不限',max_time:'不限'}}; }
function normalizeRecipe(r) {
  if(!r||typeof r.id!=='string'||!/^custom-[a-zA-Z0-9-]+$/.test(r.id)||typeof r.name!=='string'||!r.name.trim()||!MEALS.includes(r.meal)||!Number.isInteger(r.servings)||!validNumber(r.servings,8)||!Number.isInteger(r.minutes)||!validNumber(r.minutes,1440)||!Array.isArray(r.items)||!Array.isArray(r.steps))return null;
  if(r.items.length>50||r.steps.length>30)return null;
  const items=[];
  for(const i of r.items){
    if(!i||typeof i.name!=='string'||!i.name.trim()||!validNumber(i.quantity,99999)||typeof i.unit!=='string'||!i.unit.trim()||!CATEGORIES.includes(i.category))return null;
    items.push({name:i.name.trim().slice(0,40),quantity:i.quantity,unit:i.unit.trim().slice(0,8),category:i.category});
  }
  const steps=[];
  for(const s of r.steps){
    if(!s||typeof s.text!=='string'||!s.text.trim()||!Number.isInteger(s.seconds)||s.seconds<0||s.seconds>86400)return null;
    steps.push({title:String(s.title||`步骤 ${steps.length+1}`).slice(0,60),text:s.text.trim().slice(0,1000),seconds:s.seconds});
  }
  const nutrition=v=>Number.isFinite(v)&&v>=0&&v<=10000?v:null;
  return {id:r.id,name:r.name.trim().slice(0,60),meal:r.meal,servings:r.servings,minutes:r.minutes,
    subtitle:typeof r.subtitle==='string'?r.subtitle.slice(0,120):'我的家常菜',
    why:typeof r.why==='string'?r.why.slice(0,500):'这是你自己添加的菜品，可随时补充食材与做法。',
    tags:'自定义',ingredients:items.map(i=>i.name).join(' '),items,steps,kcal:nutrition(r.kcal),protein:nutrition(r.protein),custom:true};
}
function refreshRecipes() { recipes=[...builtInRecipes,...state.userRecipes]; }
function readState() {
  const base = freshState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!saved || typeof saved !== 'object') return base;
    if (validDate(saved.week)) base.week = L.monday(saved.week);
    if (Array.isArray(saved.plans)) base.plans = saved.plans.filter(p => p && typeof p.id === 'string' && typeof p.recipeId === 'string' && validDate(p.date) && MEALS.includes(p.meal) && Number.isInteger(p.servings) && validNumber(p.servings,8));
    if (Array.isArray(saved.custom)) base.custom = saved.custom.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && p.name.trim() && typeof p.unit === 'string' && validDate(p.week) && validNumber(p.quantity,99999)).map(p => ({...p,checked:!!p.checked}));
    if (Array.isArray(saved.userRecipes)) {
      const seen=new Set();
      base.userRecipes=saved.userRecipes.map(normalizeRecipe).filter(r=>{if(!r||seen.has(r.id))return false;seen.add(r.id);return true;});
    }
    if (saved.checked && typeof saved.checked === 'object' && !Array.isArray(saved.checked)) base.checked = saved.checked;
    if (saved.cook && typeof saved.cook === 'object' && !Array.isArray(saved.cook)) base.cook = saved.cook;
    if (saved.portions && typeof saved.portions === 'object') for (const [id,n] of Object.entries(saved.portions)) if (Number.isInteger(n) && validNumber(n,8)) base.portions[id]=n;
    for (const key of Object.keys(base.filters)) if (typeof saved.filters?.[key] === 'string') base.filters[key] = saved.filters[key].slice(0,500);
    return base;
  } catch { storageProblem = true; return base; }
}
let state = readState();
portions=state.portions;
function save() {
  try { localStorage.setItem(STORE,JSON.stringify(state)); }
  catch { storageProblem = true; }
  if (storageProblem) {
    const box = document.querySelector('#storage-warning'); box.hidden = false;
    box.textContent = '浏览器存储不可用或旧记录无法读取。当前操作可以继续，但刷新后可能丢失，请保留此页面并导出购物清单。';
  }
}
function toast(message) {
  const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimeout); toastTimeout = setTimeout(() => el.classList.remove('show'),3000);
}
const paths = {
  home:'<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/>',
  recipes:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  plan:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>',
  shopping:'<path d="m4 8 2 13h12l2-13zM8 8a4 4 0 0 1 8 0m-8 5v4m8-4v4"/>',
  arrow:'<path d="M4 12h15m-5-5 5 5-5 5"/>',
  back:'<path d="M20 12H5m5-5-5 5 5 5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  check:'<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
  leaf:'<path d="M19 3C8 2 2 8 5 15s14 5 14-12ZM5 20 15 8"/>',
  export:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>'
};
function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.leaf}</svg>`; }
function art(recipe, large=false) {
  const idx = recipes.indexOf(recipe) >= 0 ? recipes.indexOf(recipe) : recipes.findIndex(r => r.id===recipe.id);
  const greens=['#619054','#7ea36a','#477c46','#769f4b'];
  const colors=['#dbb98d','#d57047','#e0a080','#98b554','#a99072','#e3a844','#e2d6b4','#9980aa'];
  let filling = '';
  for (let i=0;i<24;i++) {
    const a=i*2.4, radius=18+(i%5)*9, x=160+Math.cos(a)*radius, y=112+Math.sin(a)*radius*.78;
    filling += `<ellipse cx="${x}" cy="${y}" rx="${11+i%6}" ry="${7+i%5}" transform="rotate(${i*31} ${x} ${y})" fill="${i%3===0 ? colors[(idx+8)%8] : greens[i%4]}"/>`;
  }
  for (let i=0;i<7;i++) {
    const x=129+i%3*27,y=81+Math.floor(i/3)*27;
    filling+=`<rect x="${x}" y="${y}" width="22" height="16" rx="5" transform="rotate(${i*17-15} ${x+11} ${y+8})" fill="${colors[(idx+8)%8]}" stroke="#ffffff35" stroke-width="1.5"/>`;
  }
  return `<svg class="food-art" viewBox="0 0 320 240" role="img" aria-label="${esc(recipe.name)}食材插画"><ellipse cx="162" cy="132" rx="102" ry="79" fill="#254c2410"/><ellipse cx="160" cy="118" rx="101" ry="84" fill="#fcfcf4"/><ellipse cx="160" cy="116" rx="84" ry="67" fill="#e5e6d5"/><ellipse cx="160" cy="114" rx="78" ry="62" fill="#f3edcd"/>${filling}<g fill="#f7e9b5"><circle cx="150" cy="101" r="2"/><circle cx="182" cy="128" r="2"/><circle cx="172" cy="87" r="2"/><circle cx="131" cy="130" r="2"/><circle cx="169" cy="144" r="2"/></g><path d="M44 55v111m-7-112v25q7 10 14 0V54M282 58v109m-5-109h5v46h-5z" stroke="#75896b" stroke-width="4" stroke-linecap="round" fill="none"/><path d="m260 196 20-20m-11 7c-22-23-27 8-5 7m13-14c-3-25 23-13 8 0" stroke="#879b66" fill="#99af80" stroke-width="2"/></svg>`;
}
function heading(kicker,title,description,action='') { return `<div class="page-head"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p class="subtitle">${description}</p></div>${action}</div>`; }
function nutritionValue(value,unit='') { return Number.isFinite(value)?`${value}${unit}`:'未填写'; }
function recipeCard(r,withReason=false) {
  return `<article class="recipe-card" data-recipe="${r.id}"><a href="#/recipe/${r.id}" class="recipe-cover" style="background:${['#eff1e5','#f7ece1','#eaf0e8','#f2efdf'][recipes.findIndex(x=>x.id===r.id)%4]}">${art(r)}<span class="pill">${r.minutes} 分钟 · ${r.meal}${r.custom?' · 我的菜品':''}</span></a><div class="recipe-content"><a href="#/recipe/${r.id}"><h3>${esc(r.name)}</h3></a><p>${esc(r.subtitle)}</p><div class="meta">热量 ${nutritionValue(r.kcal,' kcal')} / 份 &nbsp; · &nbsp; 蛋白质 ${nutritionValue(r.protein,' g')}${r.custom?' · 自填':''}</div>${withReason ? `<p class="reason">${esc(r.reason)}</p>` : ''}<div class="recipe-actions"><a href="#/recipe/${r.id}" class="link">查看做法 ↗</a><button class="btn small soft" data-action="add-plan" data-id="${r.id}">＋ 加入计划</button></div></div></article>`;
}
function empty(title,text,link='',label='浏览菜谱') { return `<div class="empty">${icon('leaf')}<h3>${title}</h3><p>${text}</p>${link ? `<a href="${link}" class="btn small">${label} ${icon('arrow')}</a>` : ''}</div>`; }
function weekControl() { return `<div class="week-toolbar"><button class="btn secondary" data-action="week" data-delta="-7" aria-label="上一周">‹</button><strong>${state.week.slice(0,4)} / ${state.week.slice(5).replace('-','.')} — ${L.shiftDate(state.week,6).slice(5).replace('-','.')}</strong><button class="btn secondary" data-action="week" data-delta="7" aria-label="下一周">›</button><button class="btn secondary small" data-action="this-week">本周</button></div>`; }
function weekPlans() { return state.plans.filter(p=>L.inWeek(p.date,state.week)); }
function syncPlanChecks() {
  const weeks=new Set(state.plans.map(p=>L.monday(p.date)));
  const valid=new Set([...weeks].flatMap(week=>L.aggregate(state.plans,recipes,week).map(row=>row.signature)));
  state.checked=Object.fromEntries(Object.entries(state.checked).filter(([key,value])=>value===true&&valid.has(key)));
}
function renderHome() {
  const shopping = L.aggregate(state.plans,recipes,state.week);
  const complete = shopping.filter(i=>state.checked[i.signature]).length;
  const f=state.filters;
  const options = (values,current) => values.map(v=>`<option ${v===current ? 'selected' : ''}>${esc(v)}</option>`).join('');
  main.innerHTML = `<section class="hero"><div><div class="eyebrow">A LITTLE CARE, EVERY MEAL</div><h1>今天，也要好好吃饭。</h1><p>从手边的食材出发，找到喜欢的一餐。<br>把一周的饮食与采购，安排得刚刚好。</p><div class="hero-actions"><a href="#/recipes" class="btn">寻找今日灵感 ${icon('arrow')}</a><a href="#/plan" class="btn secondary">安排一周饮食</a></div></div><div class="hero-art">${art(recipes[0],true)}<div class="hero-note">食材有搭配，生活有滋味<strong>简单一点，吃好一点。</strong></div></div></section>
  <section class="stats"><a class="stat" href="#/recipes"><span class="icon">${icon('recipes')}</span><div><div class="stat-label">可以动手做的菜谱</div><strong>${recipes.length}</strong><small>道灵感</small></div></a><a class="stat" href="#/plan"><span class="icon">${icon('plan')}</span><div><div class="stat-label">所选周已安排</div><strong>${weekPlans().length}</strong><small>道菜</small></div></a><a class="stat" href="#/shopping"><span class="icon">${icon('shopping')}</span><div><div class="stat-label">计划食材待备齐</div><strong>${shopping.length-complete}</strong><small>项食材</small></div></a></section>
  <div class="section-head"><div><h2>用手边食材，找到下一餐</h2><p>告诉我们你的偏好，看看哪些搭配适合今天。</p></div><span class="pill">本地推荐</span></div>
  <form id="recommend-form" class="panel"><div class="recommend-form"><div class="field wide"><label for="ingredients">手头食材</label><input id="ingredients" name="ingredients" maxlength="500" value="${esc(f.ingredients)}" placeholder="例如：鸡胸肉、西兰花"></div><div class="field"><label for="goal">饮食目标</label><select id="goal" name="goal">${options(['均衡','控能量','增蛋白','低钠'],f.goal)}</select></div><div class="field"><label for="flavor">口味偏好</label><select id="flavor" name="flavor">${options(['不限','快手','低油','高蛋白'],f.flavor)}</select></div><div class="field wide"><label for="avoid">需要避开的食材</label><input id="avoid" name="avoid" maxlength="500" value="${esc(f.avoid)}" placeholder="例如：虾、豆腐"></div><div class="field"><label for="max-time">制作时间偏好</label><select id="max-time" name="max_time">${options(['不限','15','20','30'],f.max_time)}</select></div></div><div class="form-actions"><button class="btn" type="submit">生成个性化建议 ${icon('arrow')}</button><small>从内置菜谱中推荐；我的菜品可在菜谱库选择。忌口按食材关键词过滤，请核对完整配料。</small></div></form>
  <div class="section-head"><div><h2>${results===null?'今日菜谱灵感':'为你推荐'}</h2><p>${results===null?'先从简单的一道菜开始。':'展开菜谱，查看食材用量与制作步骤。'}</p></div><a href="#/recipes" class="link">查看全部菜谱 →</a></div><div id="home-results">${results?.length===0?empty('暂时没有合适的菜谱','可以减少非必要的筛选条件；请保留真实忌口。'):`<div class="recipe-grid">${(results===null?recipes.slice(0,3):results).map(r=>recipeCard(r,results!==null)).join('')}</div>`}</div>`;
}
function renderRecipes() {
  main.innerHTML = heading('RECIPE COLLECTION','每一餐，都有新灵感。',`${builtInRecipes.length} 道内置菜谱 · ${state.userRecipes.length} 道我的菜品。把喜欢的家常菜也收进来。`,`<button class="btn" data-action="new-recipe">${icon('plus')} 添加我的菜品</button>`)+`<div class="toolbar"><div class="filters">${['全部',...MEALS,'我的菜品'].map(v=>`<button class="filter ${v===recipeFilter?'active':''}" data-action="filter" data-value="${v}" aria-pressed="${v===recipeFilter}">${v}</button>`).join('')}</div><input id="recipe-search" class="search" type="search" aria-label="搜索菜谱或食材" placeholder="搜索菜谱或食材…" value="${esc(query)}"></div><div id="catalog"></div>`;
  updateCatalog();
}
function updateCatalog() {
  const rows=recipes.filter(r=>(recipeFilter==='全部'||r.meal===recipeFilter||(recipeFilter==='我的菜品'&&r.custom))&&(r.name+r.ingredients).includes(query.trim()));
  document.querySelector('#catalog').innerHTML=`<div class="search-count">共 ${rows.length} 道菜谱 · 内置营养为每份示例估算，自定义营养由你填写</div>`+(rows.length?`<div class="recipe-grid">${rows.map(r=>recipeCard(r)).join('')}</div>`:empty('没有找到这道菜','试试其他食材，或者点击“添加我的菜品”记录自己的拿手菜。'));
}
function ingredientList(r,n) { return r.items.length?r.items.map(i=>`<div class="ingredient-row"><span>${esc(i.name)}</span><strong>${L.amount(i.quantity*n/r.servings)} ${esc(i.unit)}</strong></div>`).join(''):'<p class="hint">还没有填写食材。这道菜可以安排进计划，补充食材和用量后才能生成对应购物清单。</p>'; }
function editorIngredient(i={name:'',quantity:'',unit:'g',category:'蔬菜水果'}) {
  const key=++editorRow;
  return `<div class="editor-ingredient editor-row" data-editor-row="item"><div class="field"><label for="item-name-${key}">食材</label><input id="item-name-${key}" name="item-name-${key}" maxlength="40" value="${esc(i.name)}" placeholder="例如：番茄"></div><div class="field"><label for="item-quantity-${key}">数量</label><input id="item-quantity-${key}" name="item-quantity-${key}" type="number" min="0.01" max="99999" step="0.01" value="${esc(i.quantity)}" placeholder="200"></div><div class="field"><label for="item-unit-${key}">单位</label><input id="item-unit-${key}" name="item-unit-${key}" list="recipe-units" maxlength="8" value="${esc(i.unit)}" placeholder="g、个"></div><div class="field"><label for="item-category-${key}">分类</label><select id="item-category-${key}" name="item-category-${key}">${CATEGORIES.map(c=>`<option ${c===i.category?'selected':''}>${c}</option>`).join('')}</select></div><button class="btn secondary small row-remove" type="button" data-action="remove-editor-row" aria-label="删除这行食材">移除</button></div>`;
}
function editorStep(s={title:'',text:'',seconds:0}) {
  const key=++editorRow;
  return `<div class="editor-step editor-row" data-editor-row="step"><div class="dialog-row"><div class="field"><label for="step-title-${key}">步骤名称</label><input id="step-title-${key}" name="step-title-${key}" maxlength="60" value="${esc(s.title)}" placeholder="例如：炒鸡蛋"></div><div class="field"><label for="step-minutes-${key}">计时分钟数（0 表示不计时）</label><input id="step-minutes-${key}" name="step-minutes-${key}" type="number" min="0" max="1440" step="1" value="${Math.round(s.seconds/60)}"></div></div><div class="field"><label for="step-text-${key}">具体做法</label><textarea id="step-text-${key}" name="step-text-${key}" maxlength="1000" rows="2" placeholder="写下这一步怎么做…">${esc(s.text)}</textarea></div><button class="btn secondary small row-remove" type="button" data-action="remove-editor-row" aria-label="删除这条步骤">移除步骤</button></div>`;
}
function openRecipeEditor(id='') {
  const r=state.userRecipes.find(r=>r.id===id);
  if(id&&!r)return;
  editorRow=0;
  const meal=r?.meal||pendingPlan?.meal||'午餐';
  recipeDialog.innerHTML=`<div class="dialog-head"><h2 id="recipe-dialog-title">${r?'编辑我的菜品':'添加我的菜品'}</h2><button class="close-dialog" data-action="close-recipe" aria-label="关闭菜品编辑">×</button></div><p class="hint editor-intro">先填菜名就能保存。食材和做法可以稍后补充；填好食材用量后，购物清单会自动计算。</p><form id="recipe-form"><input type="hidden" name="recipeId" value="${esc(r?.id||'')}"><div class="field"><label for="recipe-name">菜名（必填）</label><input id="recipe-name" name="name" maxlength="60" required value="${esc(r?.name||'')}" placeholder="例如：番茄炒鸡蛋"></div><div class="editor-basics"><div class="field"><label for="recipe-meal">常用餐次</label><select id="recipe-meal" name="meal">${MEALS.map(m=>`<option ${m===meal?'selected':''}>${m}</option>`).join('')}</select></div><div class="field"><label for="recipe-servings">下面用料是几人份</label><input id="recipe-servings" name="servings" type="number" min="1" max="8" step="1" value="${r?.servings||1}" required></div><div class="field"><label for="recipe-minutes">预计制作时间（分钟）</label><input id="recipe-minutes" name="minutes" type="number" min="1" max="1440" step="1" value="${r?.minutes||20}" required></div></div><section class="editor-section"><h3>食材与用量（选填）</h3><p class="hint">填写上方人数所需的总用量。例：番茄 / 200 / g；鸡蛋 / 2 / 个。相同食材和单位会在购物清单中合并。</p><datalist id="recipe-units">${['g','kg','ml','个','片','张','袋','盒','勺'].map(u=>`<option value="${u}">`).join('')}</datalist><div id="editor-items">${(r?.items.length?r.items:[undefined]).map(editorIngredient).join('')}</div><button type="button" class="btn secondary small" data-action="add-recipe-item">＋ 再加一种食材</button></section><section class="editor-section"><h3>烹饪步骤（选填）</h3><div id="editor-steps">${(r?.steps.length?r.steps:[undefined]).map(editorStep).join('')}</div><button type="button" class="btn secondary small" data-action="add-recipe-step">＋ 再加一个步骤</button></section><details class="editor-section"><summary>营养信息（选填，不知道可以留空）</summary><p class="hint">按每 1 人份填写，这些数据不会自动估算。</p><div class="dialog-row"><div class="field"><label for="recipe-kcal">热量（kcal / 份）</label><input id="recipe-kcal" name="kcal" type="number" min="0" max="10000" step="0.1" value="${r?.kcal??''}"></div><div class="field"><label for="recipe-protein">蛋白质（g / 份）</label><input id="recipe-protein" name="protein" type="number" min="0" max="10000" step="0.1" value="${r?.protein??''}"></div></div></details>${r?'<p class="hint">修改用料会同步更新所有使用这道菜的饮食计划与购物清单。修改步骤会重新开始这道菜的烹饪进度。</p>':''}<p id="recipe-error" class="form-error" role="alert" hidden></p><div class="editor-actions"><button class="btn" type="submit">${pendingPlan?'保存并继续安排':'保存菜品'}</button><button class="btn secondary" type="button" data-action="close-recipe">取消</button></div></form>`;
  recipeDialog.showModal();
}
function closeRecipeEditor() {
  recipeDialog.close();
  if(pendingPlan){const draft=pendingPlan;pendingPlan=null;openPlan('','','',draft.planId,draft);}
}
function recipeFromForm(data) {
  const fail=message=>{throw new Error(message);};
  const name=(data.name||'').trim(),servings=Number(data.servings),minutes=Number(data.minutes);
  if(!name)fail('请先填写菜名。');
  if(!MEALS.includes(data.meal)||!Number.isInteger(servings)||!validNumber(servings,8)||!Number.isInteger(minutes)||!validNumber(minutes,1440))fail('请检查餐次、人数（1–8 人）和制作时间。');
  const items=[],steps=[];
  for(const key of Object.keys(data).filter(k=>k.startsWith('item-name-'))){
    const id=key.slice(10),name=data[key].trim(),raw=data['item-quantity-'+id]||'',unit=(data['item-unit-'+id]||'').trim(),category=data['item-category-'+id];
    if(!name&&!raw)continue;
    const quantity=Number(raw);
    if(!name||!validNumber(quantity,99999)||!unit||!CATEGORIES.includes(category))fail('每行食材都要填写名称、大于 0 的数量和单位；不需要的空行可以移除。');
    items.push({name,quantity,unit,category});
  }
  for(const key of Object.keys(data).filter(k=>k.startsWith('step-text-'))){
    const id=key.slice(10),text=data[key].trim(),title=(data['step-title-'+id]||'').trim(),n=Number(data['step-minutes-'+id]||0);
    if(!text&&!title&&!n)continue;
    if(!text||!Number.isInteger(n)||n<0||n>1440)fail('请填写步骤的具体做法，计时分钟数应为 0–1440 的整数。');
    steps.push({title:title||`步骤 ${steps.length+1}`,text,seconds:n*60});
  }
  if(items.length>50||steps.length>30)fail('一道菜最多支持 50 种食材、30 个步骤。');
  const nutrition=key=>{if(!data[key]?.trim())return null;const n=Number(data[key]);if(!Number.isFinite(n)||n<0||n>10000)fail('营养数值应为 0–10000，不知道可以留空。');return n;};
  return normalizeRecipe({id:data.recipeId||'custom-'+uid(),name,meal:data.meal,servings,minutes,items,steps,kcal:nutrition('kcal'),protein:nutrition('protein')});
}
function renderDetail(r) {
  const n=portions[r.id]||1;
  main.innerHTML=`<a class="back" href="#/recipes">${icon('back')} 返回菜谱库</a><section class="detail-hero"><div class="detail-image">${art(r,true)}</div><div class="detail-intro"><div class="eyebrow">COOK SOMETHING GOOD</div><span class="pill">${r.meal} · ${r.minutes} 分钟</span><h1>${esc(r.name)}</h1><p>${esc(r.why)}</p><div class="nutrition"><div><strong>${nutritionValue(r.kcal)}</strong><small>kcal / 份 · ${r.custom?'你填写的数值':'示例估算'}</small></div><div><strong>${nutritionValue(r.protein,' g')}</strong><small>蛋白质 / 份 · ${r.custom?'你填写的数值':'示例估算'}</small></div><div><strong>${r.steps.length}</strong><small>个烹饪步骤</small></div></div><div class="hero-actions"><a class="btn" href="#/cook/${r.id}">${icon('clock')} 开始烹饪</a><button class="btn secondary" data-action="add-plan" data-id="${r.id}">${icon('plus')} 加入饮食计划</button>${r.custom?`<button class="btn secondary" data-action="edit-recipe" data-id="${r.id}">编辑菜品</button><button class="btn danger" data-action="delete-recipe" data-id="${r.id}">删除菜品</button>`:''}</div></div></section><div class="two-col"><section class="panel"><div class="ingredients-head"><h2>准备食材</h2><div class="stepper"><button aria-label="减少人数" data-action="portion" data-id="${r.id}" data-delta="-1" ${n===1?'disabled':''}>−</button><span>${n} 人份</span><button aria-label="增加人数" data-action="portion" data-id="${r.id}" data-delta="1" ${n===8?'disabled':''}>＋</button></div></div>${ingredientList(r,n)}<p class="hint">用量按人数自动换算，支持 1–8 人份。${r.items.some(i=>i.name.startsWith('熟'))?'标注“熟”的食材按熟重准备。':''}加入计划后，清单自动汇总采购用量。</p></section><section class="panel"><h2>一步步，做好这道菜</h2>${!r.steps.length?'<p class="hint">还没有填写做法。点击“编辑菜品”补充步骤后，就可以使用烹饪模式。</p>':''}<ol class="steps-list">${r.steps.map((s,i)=>`<li><span class="step-number">${i+1}</span><div><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p>${s.seconds?`<small class="muted">${Math.round(s.seconds/60)} 分钟参考计时</small>`:''}</div></li>`).join('')}</ol><p class="hint">制作时间可能因份量和设备有所变化；计时结束后仍需检查实际熟度。</p></section></div>`;
}
function openPlan(recipeId='',date='',meal='晚餐',planId='',draft=null) {
  const old=state.plans.find(p=>p.id===planId);
  const initialDate=draft?.date||old?.date||date||(L.inWeek(today,state.week)?today:state.week);
  const initialRecipe=draft?.recipeId||old?.recipeId||recipeId||recipes[0].id;
  const initialMeal=draft?.meal||old?.meal||meal;
  const servings=draft?.servings||old?.servings||portions[initialRecipe]||1;
  dialog.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${old?'修改这道安排':'给一餐加点灵感'}</h2><button class="close-dialog" data-action="close-dialog" aria-label="关闭">×</button></div><form id="plan-form"><input type="hidden" name="planId" value="${esc(planId)}"><div class="field"><label for="plan-recipe">菜谱</label><select id="plan-recipe" name="recipeId">${recipes.map(r=>`<option value="${r.id}" ${r.id===initialRecipe?'selected':''}>${esc(r.name)}${r.custom?'（我的菜品）':''}</option>`).join('')}</select><button class="btn secondary small" type="button" data-action="new-recipe-from-plan">＋ 没有想吃的？自己添加菜品</button></div><div class="dialog-row"><div class="field"><label for="plan-date">日期</label><input id="plan-date" name="date" type="date" value="${initialDate}" required></div><div class="field"><label for="plan-meal">餐次</label><select id="plan-meal" name="meal">${MEALS.map(m=>`<option ${m===initialMeal?'selected':''}>${m}</option>`).join('')}</select></div></div><div class="field"><label for="plan-servings">人数 / 份数</label><input id="plan-servings" name="servings" type="number" min="1" max="8" step="1" required value="${servings}"></div><p class="hint">同一餐可以安排多道菜。购物清单会按日期与人数自动合并食材。</p><button class="btn" type="submit">${old?'保存修改':'加入饮食计划'}</button></form>`;
  dialog.showModal();
}
function renderPlan() {
  const items=weekPlans();
  const filled=new Set(items.map(p=>p.date+p.meal)).size;
  main.innerHTML=heading('YOUR WEEK, WELL PLANNED','把这一周，安排好。','早餐、午餐、晚餐，留一点时间给认真吃饭。',`<button class="btn" data-action="add-plan">${icon('plus')} 添加一道菜</button>`)+weekControl()+`<div class="weekly-summary"><span>已安排 <strong>${filled}</strong> / 21 个餐次</span><span>共 <strong>${items.length}</strong> 道菜</span><a class="link" href="#/shopping">查看本周购物清单 →</a></div>${!items.length?`<div class="plan-prompt">这一周还是空白。点击任一餐次的「＋」，或者从菜谱详情加入第一道菜。</div>`:''}<div class="week-board">${Array.from({length:7},(_,day)=>{
    const date=L.shiftDate(state.week,day);
    return `<section class="day-column"><div class="day-head ${date===today?'today':''}"><strong>${['周一','周二','周三','周四','周五','周六','周日'][day]}${date===today?' · 今天':''}</strong><small>${date.slice(5).replace('-',' / ')}</small></div>${MEALS.map(meal=>`<div class="meal-slot"><div class="meal-label">${meal}</div>${items.filter(p=>p.date===date&&p.meal===meal).map(p=>{
      const r=recipes.find(r=>r.id===p.recipeId); if(!r)return '';
      return `<div class="plan-meal" data-plan-id="${esc(p.id)}"><a href="#/recipe/${r.id}">${esc(r.name)}</a><small>${p.servings} 人份 · ${r.minutes} 分钟</small><div class="plan-controls"><button data-action="edit-plan" data-id="${esc(p.id)}">修改</button><button class="remove" data-action="remove-plan" data-id="${esc(p.id)}" aria-label="移除${esc(r.name)}">移除</button></div></div>`;
    }).join('')}<button class="slot-add" data-action="add-plan" data-date="${date}" data-meal="${meal}" aria-label="添加${date}${meal}">＋</button></div>`).join('')}</section>`;
  }).join('')}</div><p class="hint">人数会影响采购总量。计划以实际日期保存，切换周次或刷新页面不会改变安排。</p>`;
}
function shoppingRows() {
  const generated=L.aggregate(state.plans,recipes,state.week).map(i=>({...i,checked:!!state.checked[i.signature],type:'auto'}));
  const custom=state.custom.filter(i=>i.week===state.week).map(i=>({...i,key:i.id,category:'其他',type:'custom',sources:['手动添加']}));
  return [...generated,...custom];
}
function renderShopping() {
  const rows=shoppingRows(), done=rows.filter(i=>i.checked).length;
  const missing=[...new Set(weekPlans().map(p=>p.recipeId))].map(id=>recipes.find(r=>r.id===id)).filter(r=>r&&!r.items.length);
  main.innerHTML=heading('LESS GUESSING, BETTER SHOPPING','备齐食材，安心下厨。','按周汇总饮食计划，自动合并同名、同单位的食材。',`<button class="btn secondary" data-action="export-list" ${!rows.length?'disabled':''}>${icon('export')} 导出清单</button>`)+weekControl()+`<div class="weekly-summary"><span>${weekPlans().length} 道计划菜谱</span><span>${rows.length} 项采购项目</span><a href="#/plan" class="link">调整饮食计划 →</a></div><div class="shopping-layout"><div class="panel">${rows.length?CATEGORIES.map(category=>{
    const group=rows.filter(i=>i.category===category); if(!group.length)return '';
    return `<section class="shopping-group"><h3>${category}<span class="pill">${group.length} 项</span></h3>${group.map((row,index)=>{
      const id=`item-${CATEGORIES.indexOf(category)}-${index}`;
      return `<div class="shopping-row ${row.checked?'checked':''}" data-item-name="${esc(row.name)}"><input id="${id}" type="checkbox" aria-label="${esc(row.name)}已备齐" data-check-type="${row.type}" data-check-key="${esc(row.type==='auto'?row.signature:row.id)}" ${row.checked?'checked':''}><label for="${id}"><strong>${esc(row.name)}</strong><small>${esc([...new Set(row.sources)].join(' / '))}</small></label><span class="quantity">${L.amount(row.quantity)} ${esc(row.unit)}</span>${row.type==='custom'?`<button class="remove" data-action="remove-custom" data-id="${esc(row.id)}" aria-label="删除${esc(row.name)}">×</button>`:''}</div>`;
    }).join('')}</section>`;
  }).join(''):empty('清单还没有内容','先安排一餐，所需食材就会出现在这里。也可以手动添加采购项目。','#/plan','去安排一餐')}<p class="hint">勾选表示已购买或家中已有。计划食材的总量变化时，会自动取消该项勾选，便于重新核对。不同单位分别显示；手动项目独立保留。</p></div><aside class="shopping-side"><div class="shopping-progress"><div><strong>${done}</strong><span> / ${rows.length} 项已备齐</span></div><div class="progress-track"><div class="progress-fill" style="width:${rows.length?done/rows.length*100:0}%"></div></div><span>${rows.length&&done===rows.length?'食材准备好了，去做一顿好饭吧。':'采购有条理，下厨更从容。'}</span></div><section class="panel"><h2>还需要带点什么？</h2><p class="hint" style="margin:0 0 15px">手动补充到当前所选周的清单。</p><form id="custom-form"><div class="field"><label for="custom-name">食材或物品名称</label><input name="name" id="custom-name" required maxlength="40" placeholder="例如：厨房纸"></div><div class="quantity-fields"><div class="field"><label for="custom-quantity">数量</label><input name="quantity" id="custom-quantity" type="number" min="0.01" max="99999" step="0.01" value="1" required></div><div class="field"><label for="custom-unit">单位</label><select id="custom-unit" name="unit">${['个','g','kg','ml','袋','盒','卷','片'].map(u=>`<option>${u}</option>`).join('')}</select></div></div><button class="btn" type="submit">${icon('plus')} 添加到清单</button></form></section></aside></div>`;
  if(missing.length)main.insertAdjacentHTML('afterbegin',`<div class="plan-prompt">本周有 ${missing.length} 道菜还没填食材：${missing.map(r=>`<a class="link" href="#/recipe/${r.id}">${esc(r.name)}</a>`).join('、')}。点击菜名补充用料后，才会计入购物清单。</div>`);
}
function cookState(r) {
  let c=state.cook[r.id];
  if (!c || !Number.isInteger(c.step) || c.step<0 || c.step>=r.steps.length || !Number.isFinite(c.remaining) || c.remaining<0 || c.remaining>86400 || !Number.isFinite(c.endAt) || typeof c.running!=='boolean') {
    c={step:0,complete:false,remaining:r.steps[0].seconds,endAt:0,running:false}; state.cook[r.id]=c;
  }
  return c;
}
function renderCooking(r) {
  if(!r.steps.length){main.innerHTML=heading('COOKING MODE',esc(r.name),'还没有填写烹饪步骤。')+`<div class="panel"><p>先补充做法，就可以逐步烹饪和计时。</p><button class="btn" data-action="edit-recipe" data-id="${r.id}">补充做法</button> <a class="btn secondary" href="#/recipe/${r.id}">返回菜品详情</a></div>`;return;}
  const c=cookState(r), n=portions[r.id]||1, step=r.steps[c.step];
  main.innerHTML=`<div class="cooking"><a class="back" href="#/recipe/${r.id}">${icon('back')} 返回菜谱详情</a>${heading('COOKING MODE',esc(r.name),'跟着步骤慢慢来，计时可以暂停，进度会自动保留。')}${c.complete?`<div class="panel completion">${icon('check')}<h2>这一餐，完成了。</h2><p class="muted">检查食物熟度，摆好餐具，享受你的成果。</p><a href="#/plan" class="btn">查看饮食计划</a><button class="btn secondary" data-action="cook-restart" data-id="${r.id}">重新做一遍</button></div>`:`<div class="step-dots">${r.steps.map((_,i)=>`<span class="step-dot ${i<=c.step?'done':''}"></span>`).join('')}</div><section class="cooking-step"><span class="step-counter">STEP ${String(c.step+1).padStart(2,'0')} / ${String(r.steps.length).padStart(2,'0')}</span><h2>${esc(step.title)}</h2><p class="instruction">${esc(step.text)}</p>${step.seconds?`<div class="timer-box"><div class="timer-clock" id="timer-clock" role="timer" aria-label="烹饪剩余时间"></div><div class="timer-state" id="timer-state" aria-live="polite"></div><button class="btn small" data-action="timer-toggle" data-id="${r.id}" id="timer-toggle"></button><button class="btn secondary small" data-action="timer-reset" data-id="${r.id}">重置计时</button></div>`:`<p class="hint">这一步无需计时，准备好后继续下一步。</p>`}<div class="cook-controls"><button class="btn secondary" data-action="cook-step" data-id="${r.id}" data-delta="-1" ${c.step===0?'disabled':''}>上一步</button><button class="btn" data-action="cook-step" data-id="${r.id}" data-delta="1">${c.step===r.steps.length-1?'完成烹饪':'完成此步 · 下一步'} ${icon('arrow')}</button></div><p class="hint">切换步骤会结束当前步骤的计时。份量和火力会影响时长，请检查实际熟度。</p></section>`}<details><summary>查看食材用量 · ${n} 人份</summary>${ingredientList(r,n)}</details></div>`;
  updateTimer();
}
function updateTimer() {
  const route=location.hash.split('/'); if(route[1]!=='cook')return;
  const r=recipes.find(r=>r.id===route[2]); if(!r||!r.steps.length)return;
  const c=cookState(r); if(c.complete)return;
  let seconds=c.remaining;
  if(c.running) {
    seconds=Math.max(0,Math.ceil((c.endAt-Date.now())/1000));
    if(seconds===0) {
      c.running=false;c.remaining=0;c.endAt=0;save();
      const announcement=r.id+c.step;
      if(timerAnnounced!==announcement){toast('计时结束，请检查食物熟度。');timerAnnounced=announcement;}
    }
  }
  const clock=document.querySelector('#timer-clock'); if(!clock)return;
  clock.textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  const label=seconds===0?'计时结束，请检查实际熟度':c.running?'正在计时，页面切换后仍会继续':'参考计时 · 点击开始或继续';
  const stateEl=document.querySelector('#timer-state'); if(stateEl.textContent!==label)stateEl.textContent=label;
  document.querySelector('#timer-toggle').textContent=c.running?'暂停计时':seconds===0?'重新计时':'开始 / 继续';
}
function render() {
  const parts=(location.hash||'#/home').replace(/^#\/?/,'').split('/');
  const section=parts[0]||'home', id=parts[1];
  const navSection=['recipe','cook'].includes(section)?'recipes':section;
  const names={home:'饮食工作台',recipes:'菜谱灵感',plan:'一周饮食计划',shopping:'购物清单'};
  document.querySelector('#nav').innerHTML=Object.entries(names).map(([key,label])=>`<a class="nav-item ${navSection===key?'active':''}" href="#/${key}" ${navSection===key?'aria-current="page"':''}>${icon(key)}<span>${label}</span></a>`).join('');
  document.querySelector('#breadcrumb').textContent=section==='cook'?'菜谱灵感 / 烹饪模式':section==='recipe'?'菜谱灵感 / 菜谱详情':names[section]||'饮食空间';
  document.title=`${section==='cook'?'烹饪模式':names[navSection]||'饮食空间'} · Flavormate`;
  if(section==='home')renderHome();
  else if(section==='recipes')renderRecipes();
  else if(section==='plan')renderPlan();
  else if(section==='shopping')renderShopping();
  else if(section==='recipe'||section==='cook'){
    const r=recipes.find(r=>r.id===id);
    if(r){ if(section==='recipe')renderDetail(r);else renderCooking(r); }
    else main.innerHTML=empty('这道菜谱不存在','返回菜谱库重新选择吧。','#/recipes');
  } else main.innerHTML=empty('找不到这个页面','回到饮食工作台继续吧。','#/home','返回工作台');
  if(lastRoute!==location.hash){window.scrollTo(0,0);main.focus({preventScroll:true});lastRoute=location.hash;}
}
document.addEventListener('click',event=>{
  if(event.target.closest('.skip-link')){event.preventDefault();main.focus();return;}
  const el=event.target.closest('[data-action]'); if(!el)return;
  const {action,id,date,meal,delta,value}=el.dataset;
  if(action==='close-dialog')dialog.close();
  else if(action==='new-recipe'){pendingPlan=null;openRecipeEditor();}
  else if(action==='edit-recipe'){pendingPlan=null;openRecipeEditor(id);}
  else if(action==='new-recipe-from-plan'){
    const draft=Object.fromEntries(new FormData(document.querySelector('#plan-form')));
    pendingPlan={...draft,servings:Number(draft.servings)};dialog.close();openRecipeEditor();
  }
  else if(action==='close-recipe')closeRecipeEditor();
  else if(action==='add-recipe-item')document.querySelector('#editor-items').insertAdjacentHTML('beforeend',editorIngredient());
  else if(action==='add-recipe-step')document.querySelector('#editor-steps').insertAdjacentHTML('beforeend',editorStep());
  else if(action==='remove-editor-row')el.closest('.editor-row')?.remove();
  else if(action==='delete-recipe'){
    const r=state.userRecipes.find(r=>r.id===id);if(!r)return;
    const count=state.plans.filter(p=>p.recipeId===id).length;
    if(count)return toast(`还有 ${count} 条饮食计划使用这道菜，请先移除这些安排，再删除菜品。`);
    if(!window.confirm(`确定删除“${r.name}”？`))return;
    state.userRecipes=state.userRecipes.filter(r=>r.id!==id);delete state.cook[id];delete portions[id];
    refreshRecipes();syncPlanChecks();save();location.hash='#/recipes';render();toast('已删除我的菜品');
  }
  else if(action==='add-plan')openPlan(id,date,meal||recipes.find(r=>r.id===id)?.meal||'晚餐');
  else if(action==='edit-plan')openPlan('','','',id);
  else if(action==='remove-plan'){
    const removed=state.plans.find(p=>p.id===id);state.plans=state.plans.filter(p=>p.id!==id);syncPlanChecks();save();render();
    if(removed)toast('已移除此菜，购物清单同步更新');
  }
  else if(action==='portion'){portions[id]=Math.max(1,Math.min(8,(portions[id]||1)+Number(delta)));save();render();}
  else if(action==='filter'){recipeFilter=value;render();}
  else if(action==='week'){state.week=L.shiftDate(state.week,Number(delta));save();render();}
  else if(action==='this-week'){state.week=L.monday();save();render();}
  else if(action==='remove-custom'){state.custom=state.custom.filter(p=>p.id!==id);save();render();toast('已删除手动项目');}
  else if(action==='export-list'){
    const rows=shoppingRows();
    const text=`Flavormate 购物清单\n${state.week} 至 ${L.shiftDate(state.week,6)}\n\n`+rows.map(i=>`${i.checked?'[已备齐]':'[待采购]'} ${i.name} ${L.amount(i.quantity)} ${i.unit}${i.type==='custom'?'（手动）':''}`).join('\n');
    const url=URL.createObjectURL(new Blob(['\uFEFF'+text],{type:'text/plain;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=`Flavormate-购物清单-${state.week}.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('购物清单已导出');
  }
  else if(action.startsWith('cook-')||action.startsWith('timer-')){
    const r=recipes.find(r=>r.id===id);if(!r||!r.steps.length)return;const c=cookState(r);
    if(action==='cook-restart'){state.cook[id]={step:0,complete:false,remaining:r.steps[0].seconds,running:false,endAt:0};}
    if(action==='cook-step'){
      const next=c.step+Number(delta);c.running=false;c.endAt=0;
      if(next>=r.steps.length)c.complete=true;
      else {c.step=Math.max(0,next);c.remaining=r.steps[c.step].seconds;c.complete=false;}
      timerAnnounced='';
    }
    if(action==='timer-reset'){c.remaining=r.steps[c.step].seconds;c.running=false;c.endAt=0;timerAnnounced='';}
    if(action==='timer-toggle'){
      if(c.running){c.remaining=Math.max(0,Math.ceil((c.endAt-Date.now())/1000));c.running=false;c.endAt=0;}
      else {if(!c.remaining)c.remaining=r.steps[c.step].seconds;c.endAt=Date.now()+c.remaining*1000;c.running=true;timerAnnounced='';}
    }
    save();render();
  }
});
document.addEventListener('input',event=>{
  if(event.target.id==='recipe-search'){query=event.target.value;updateCatalog();}
});
document.addEventListener('change',event=>{
  const el=event.target;
  if(el.closest('#recommend-form')){state.filters=Object.fromEntries(new FormData(document.querySelector('#recommend-form')));save();}
  if(el.dataset.checkType){
    if(el.dataset.checkType==='auto')state.checked[el.dataset.checkKey]=el.checked;
    else {const i=state.custom.find(i=>i.id===el.dataset.checkKey);if(i)i.checked=el.checked;}
    const oldId=el.id;save();render();document.getElementById(oldId)?.focus({preventScroll:true});
  }
});
document.addEventListener('submit',async event=>{
  const form=event.target;event.preventDefault();
  const data=Object.fromEntries(new FormData(form));
  if(form.id==='recipe-form'){
    try {
      if(data.recipeId&&!state.userRecipes.some(r=>r.id===data.recipeId))throw new Error('这道菜已被移除，请关闭后重新添加。');
      const r=recipeFromForm(data);if(!r)throw new Error('菜品信息不完整，请检查后再保存。');
      const index=state.userRecipes.findIndex(x=>x.id===r.id),old=state.userRecipes[index];
      if(old){state.userRecipes[index]=r;if(JSON.stringify(old.steps)!==JSON.stringify(r.steps))delete state.cook[r.id];}
      else {state.userRecipes.push(r);portions[r.id]=r.servings;}
      refreshRecipes();syncPlanChecks();save();recipeDialog.close();
      if(pendingPlan){const draft={...pendingPlan,recipeId:r.id};pendingPlan=null;render();openPlan('','','',draft.planId,draft);}
      else {location.hash=`#/recipe/${r.id}`;render();}
      toast('菜品已保存，可以加入任意一天的饮食计划');
    } catch(error) {
      const message=document.querySelector('#recipe-error');message.hidden=false;message.textContent=error.message;message.scrollIntoView({block:'nearest'});
    }
    return;
  }
  if(form.id==='plan-form'){
    const servings=Number(data.servings);
    if(!validDate(data.date)||!MEALS.includes(data.meal)||!Number.isInteger(servings)||!validNumber(servings,8)||!recipes.some(r=>r.id===data.recipeId)){toast('请填写有效的日期、餐次与人数');return;}
    const plan={id:data.planId||uid(),recipeId:data.recipeId,date:data.date,meal:data.meal,servings};
    const i=state.plans.findIndex(p=>p.id===data.planId);if(i>=0)state.plans[i]=plan;else state.plans.push(plan);
    state.week=L.monday(data.date);syncPlanChecks();save();dialog.close();render();toast('饮食计划已保存，购物清单同步更新');
  }
  if(form.id==='custom-form'){
    const quantity=Number(data.quantity),name=data.name.trim();
    if(!name||!validNumber(quantity,99999))return toast('请填写项目名称和大于零的数量');
    state.custom.push({id:uid(),name:name.slice(0,40),quantity,unit:data.unit,week:state.week,checked:false});save();render();toast('已添加到购物清单');
  }
  if(form.id==='recommend-form'){
    state.filters=data;save();const button=form.querySelector('button[type="submit"]');button.disabled=true;button.textContent='正在整理推荐…';
    try {
      let response=await fetch('./recipes.json');
      if(!response.ok)throw new Error('recommend failed');
      const all=await response.json();
      const text=[data.ingredients,data.goal].filter(Boolean).join(' ').toLowerCase();
      const avoid=String(data.exclusions||'').toLowerCase().split(/[，,、\s]+/).filter(Boolean);
      results=all.map(r=>{const hay=(r.name+' '+r.tags+' '+r.ingredients).toLowerCase();let score=0; if(text) text.split(/[，,、\s]+/).filter(Boolean).forEach(k=>{if(hay.includes(k))score+=3}); avoid.forEach(k=>{if(hay.includes(k))score-=20}); return {...r,_score:score};}).filter(r=>r._score>=0).sort((a,b)=>b._score-a._score).slice(0,3).map(({_score,...r})=>r);
      if(!location.hash||location.hash==='#/home'){render();document.querySelector('#home-results').scrollIntoView({behavior:'smooth',block:'center'});}
      toast(`已找到 ${results.length} 道推荐菜谱`);
    }catch{toast('推荐服务暂时不可用，请确认启动窗口仍在运行');}
    finally{button.disabled=false;if(button.isConnected)button.innerHTML=`生成个性化建议 ${icon('arrow')}`;}
  }
});
recipeDialog.addEventListener('cancel',event=>{event.preventDefault();closeRecipeEditor();});
window.addEventListener('hashchange',()=>{if(dialog.open)dialog.close();if(recipeDialog.open)recipeDialog.close();pendingPlan=null;if(recipes.length)render();});
window.addEventListener('storage',event=>{if(event.key===STORE){state=readState();portions=state.portions;refreshRecipes();if(recipes.length)render();}});
document.querySelector('#today-label').textContent=new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'});
(async()=>{
  try {
    const response=await fetch('./recipes.json');if(!response.ok)throw new Error('load');builtInRecipes=await response.json();refreshRecipes();
    state.plans=state.plans.filter(p=>recipes.some(r=>r.id===p.recipeId));
    syncPlanChecks();
    if(storageProblem)save();render();setInterval(updateTimer,250);
  }catch{main.innerHTML='<div class="error"><h2>菜谱暂时没有加载成功</h2><p>请保持启动窗口开启，再刷新页面重试。</p><a class="btn secondary" href="./">重新加载</a></div>';}
})();
