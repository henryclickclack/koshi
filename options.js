// Panel background color. chrome.storage.local is per profile, and each
// Helium space is its own profile — so every space keeps its own color.
const customEl = document.getElementById('custom');
const colorEl = document.getElementById('color');

function save() {
  if (customEl.checked) chrome.storage.local.set({ bgColor: colorEl.value });
  else chrome.storage.local.remove('bgColor');
}

chrome.storage.local.get('bgColor').then(({ bgColor }) => {
  customEl.checked = !!bgColor;
  if (bgColor) colorEl.value = bgColor;
});

customEl.addEventListener('change', save);
colorEl.addEventListener('input', () => { customEl.checked = true; save(); });
