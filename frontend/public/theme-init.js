(function () {
  try {
    var saved = localStorage.getItem('sencho-theme');
    if (saved === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
    }
  } catch (e) { }
})();
