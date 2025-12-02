// 目前只做簡單的年份更新，之後你要再加互動邏輯也可以寫在這裡
document.addEventListener("DOMContentLoaded", () => {
  const yearSpan = document.getElementById("year");
  if (yearSpan) {
    yearSpan.textContent = new Date().getFullYear();
  }
});
