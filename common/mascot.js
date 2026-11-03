/*
 * 吉祥物：藍色棒棒糖（大豬）／粉紅色棒棒糖（小豬），取自兩人手作的簇絨地毯。
 * 圖案沿用舊的「大小豬健康食記」，各功能頁都用 FiveJS.lollipop() 畫；每日一問的封蠟是 FiveJS.waxSeal()。
 * palette：'blue' | 'pink'；mood：'happy' | 'wave' | 'sleep' | 'hungry' | 'full' | 'sparkle' | 'over'
 */
(() => {
  function lollipop(palette = "pink", mood = "happy", size = 48) {
    const C = palette === "blue" ? { main: "#3F7FD6", deep: "#2A5FA8", stick: "#3F7FD6" } : { main: "#F0679A", deep: "#C94479", stick: "#F58AB3" };
    const bowC = "#F58AB3", bowD = "#D9588A";
    const K = "#4A2E3A";
    const star = x => `<path transform="translate(${x} 40) scale(1.15)" d="M0-5.5l1.6 3.6 3.9.4-2.9 2.6.9 3.8L0 3.4l-3.5 2 .9-3.8-2.9-2.6 3.9-.4z" fill="#FFB23E" stroke="${K}" stroke-width=".9" stroke-linejoin="round"/>`;
    const eyes = mood === "over" ? `<ellipse cx="44" cy="40" rx="3" ry="3.8" fill="${K}"/><ellipse cx="60" cy="40" rx="3" ry="3.8" fill="${K}"/><circle cx="45" cy="38.6" r="1.1" fill="#fff"/><circle cx="61" cy="38.6" r="1.1" fill="#fff"/><path d="M38 35.5l9-2.6M66 35.5l-9-2.6" fill="none" stroke="${K}" stroke-width="2.2" stroke-linecap="round"/>`
      : mood === "sparkle" ? star(44) + star(60)
      : mood === "sleep" ? `<path d="M40 40q4 3.5 8 0M56 40q4 3.5 8 0" fill="none" stroke="${K}" stroke-width="2.6" stroke-linecap="round"/>`
      : (mood === "happy" || mood === "wave" || mood === "full") ? `<path d="M40 41q4-6 8 0M56 41q4-6 8 0" fill="none" stroke="${K}" stroke-width="2.8" stroke-linecap="round"/>`
      : `<ellipse cx="44" cy="39" rx="3" ry="4" fill="${K}"/><ellipse cx="60" cy="39" rx="3" ry="4" fill="${K}"/><circle cx="45" cy="37.6" r="1.1" fill="#fff"/><circle cx="61" cy="37.6" r="1.1" fill="#fff"/>`;
    const mouth = mood === "over" ? `<path d="M46 50q3-3 6 0t6 0" fill="none" stroke="${K}" stroke-width="2.4" stroke-linecap="round"/>`
      : (mood === "sparkle" || mood === "full") ? `<path d="M45 46q7 10 14 0z" fill="${K}" stroke="${K}" stroke-width="1.6" stroke-linejoin="round"/><path d="M49 50q3 2.6 6 0" fill="#F58AB3"/>`
      : mood === "hungry" ? `<ellipse cx="52" cy="50" rx="3.6" ry="4.2" fill="${K}"/><ellipse cx="52" cy="51.5" rx="2" ry="1.6" fill="#F58AB3"/>`
      : mood === "sleep" ? `<path d="M49 49.5q3 2 6 0" fill="none" stroke="${K}" stroke-width="2.2" stroke-linecap="round"/>`
      : `<path d="M46 48q6 6.5 12 0" fill="none" stroke="${K}" stroke-width="2.4" stroke-linecap="round"/>`;
    const blush = mood === "full" ? 'rx="5" ry="3.2" opacity=".8"' : 'rx="4" ry="2.6" opacity=".6"';
    const face = `<circle cx="52" cy="43" r="16" fill="#fff"/><ellipse cx="38" cy="47" ${blush} fill="#F58AB3"/><ellipse cx="66" cy="47" ${blush} fill="#F58AB3"/>${eyes}${mouth}`;
    const sparkles = '<g class="bob"><path d="M92 18l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z" fill="#FFD36B"/><path d="M8 22l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" fill="#FFD36B"/></g>';
    const extra = mood === "over" ? '<path d="M82 22q5 7 0 11q-5-4 0-11z" fill="#8FD0F2" stroke="#4F9CC8" stroke-width="1.4" stroke-linejoin="round"/>'
      : (mood === "sparkle" || mood === "wave") ? sparkles
      : mood === "sleep" ? '<text x="88" y="30" font-size="14" font-weight="700" fill="currentColor" opacity=".6">z</text><text x="97" y="17" font-size="11" font-weight="700" fill="currentColor" opacity=".6">z</text>'
      : "";
    return `<svg class="lollipop" width="${size}" height="${size}" viewBox="0 0 108 100" aria-hidden="true"><g class="bob"><g transform="translate(2 0)">
      <rect x="44" y="70" width="12" height="28" rx="6" fill="${C.stick}" stroke="${C.deep}" stroke-width="2"/>
      <circle cx="50" cy="40" r="36" fill="${C.main}" stroke="${C.deep}" stroke-width="2.2"/>
      <circle cx="50" cy="40" r="27" fill="#fff"/>
      <path d="M50 40a4 4 0 0 1 8 0a8 8 0 0 1-16 0a12 12 0 0 1 24 0a16 16 0 0 1-32 0a20 20 0 0 1 40 0" fill="none" stroke="${C.main}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <g transform="translate(-2 0)">${face}</g>
      <g transform="translate(50 72)"><path d="M0 0l-13-8q-3 8 0 16z M0 0l13-8q3 8 0 16z" fill="${bowC}" stroke="${bowD}" stroke-width="1.6" stroke-linejoin="round"/><circle r="4" fill="${bowC}" stroke="${bowD}" stroke-width="1.6"/></g>
      </g>${extra}</g></svg>`;
  }

  // 棒棒糖封蠟（每日一問的信封）：照兩支棒棒糖娃娃，白色外圈、彩色漩渦、漩渦上的白色縫線，
  // 蠟塊下面露出棒子和粉紅蝴蝶結。大豬（blue）粉藍、小豬（pink）粉紅。
  function waxSeal(palette = "pink", size = 48) {
    const C = palette === "blue" ? { wax: "#8CC8EA", hi: "#C4E6F7", lo: "#5E9FC7", deep: "#477FA6" } : { wax: "#F29BBE", hi: "#FAD0E1", lo: "#D4709A", deep: "#B0527C" };
    let d = "";
    for (let i = 0; i <= 72; i++) {
      const a = i / 72 * Math.PI * 2, r = 44 + 1.6 * Math.sin(a * 7) + 1.1 * Math.sin(a * 11 + 1) + (i === 20 || i === 21 ? 3 : 0);
      d += (i ? "L" : "M") + (50 + r * Math.cos(a)).toFixed(1) + " " + (50 + r * Math.sin(a)).toFixed(1);
    }
    const sp = "M50 50a3 3 0 0 1 6 0a6 6 0 0 1-12 0a9 9 0 0 1 18 0a12 12 0 0 1-24 0a15 15 0 0 1 30 0a18 18 0 0 1-36 0";
    return `<svg class="wax-seal" width="${size}" height="${Math.round(size * 1.18)}" viewBox="0 0 100 118" aria-hidden="true">
      <rect x="46" y="86" width="8" height="28" rx="4" fill="#FBF6EE" stroke="#D9CBB8" stroke-width="1.2"/>
      <path d="${d}Z" fill="${C.wax}" stroke="${C.lo}" stroke-width="1.5"/>
      <g transform="translate(50 101)"><path d="M0 0l-13-7q-3 7 0 14z M0 0l13-7q3 7 0 14z" fill="#F7A9C6" stroke="#D9588A" stroke-width="1.3" stroke-linejoin="round"/><circle r="3.6" fill="#F7A9C6" stroke="#D9588A" stroke-width="1.3"/></g>
      <circle cx="50" cy="50" r="35" fill="none" stroke="${C.lo}" stroke-width="2" opacity=".55"/>
      <circle cx="50" cy="50" r="31" fill="#FDFBF8" stroke="${C.hi}" stroke-width="1.5"/>
      <circle cx="50" cy="50" r="25" fill="${C.wax}"/>
      <path d="${sp}" transform="translate(-3 0)" fill="none" stroke="${C.deep}" stroke-width="3.6" stroke-linecap="round" opacity=".55"/>
      <path d="${sp}" transform="translate(-3 -.8)" fill="none" stroke="${C.hi}" stroke-width="3" stroke-linecap="round"/>
      <path d="${sp}" transform="translate(-3 -.8)" fill="none" stroke="#fff" stroke-width="1.1" stroke-dasharray="2 2.6" stroke-linecap="round"/>
      <ellipse cx="34" cy="30" rx="9" ry="4" transform="rotate(-35 34 30)" fill="#fff" opacity=".45"/></svg>`;
  }

  window.FiveJS = Object.assign(window.FiveJS || {}, { lollipop, waxSeal });
})();
