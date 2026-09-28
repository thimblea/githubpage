(function (root) {
  'use strict';
  function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function parseDate(s) {
    const [y,m,d] = s.split('-').map(Number);
    return new Date(y,m-1,d,12);
  }
  function shiftDate(s, n) {
    const d = parseDate(s); d.setDate(d.getDate()+n); return dateKey(d);
  }
  function monday(s = dateKey(new Date())) {
    const d = parseDate(s); return shiftDate(s,-((d.getDay()+6)%7));
  }
  function amount(n) { return String(Math.round(n*100)/100); }
  function inWeek(date, week) { return date >= week && date <= shiftDate(week,6); }
  function aggregate(plans, recipes, week) {
    const result = new Map();
    for (const plan of plans.filter(p => inWeek(p.date,week))) {
      const recipe = recipes.find(r => r.id === plan.recipeId);
      if (!recipe) continue;
      for (const ingredient of recipe.items) {
        const key = JSON.stringify([ingredient.name,ingredient.unit]);
        if (!result.has(key)) result.set(key,{...ingredient,key,quantity:0,sources:[]});
        const row = result.get(key);
        row.quantity += ingredient.quantity * plan.servings / recipe.servings;
        row.sources.push(`${plan.date.slice(5)} ${plan.meal} · ${recipe.name}`);
      }
    }
    return Array.from(result.values()).map(row => {
      row.quantity = Math.round(row.quantity*100)/100;
      // A changed quantity requires reconfirmation; old purchases cannot cover added demand.
      row.signature = JSON.stringify([week,row.key,row.quantity]);
      return row;
    });
  }
  const api = {dateKey, parseDate, shiftDate, monday, amount, inWeek, aggregate};
  root.MealLogic = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
