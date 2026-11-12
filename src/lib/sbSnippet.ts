export const SB_KEY = 'kx.sb';
export const DESKTOP_FROM = 761;
export const SB_SNIPPET = `try{if(localStorage.getItem('${SB_KEY}')==='closed'&&innerWidth>=${DESKTOP_FROM})document.documentElement.classList.add('sb-collapsed')}catch(e){}`;
