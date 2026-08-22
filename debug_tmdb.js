const KEY = '7039c79558d9a2c4fa1a63219272dc84';

(async () => {
  const s = await fetch(`https://api.themoviedb.org/3/tv/91768/season/2?api_key=${KEY}&language=it-IT`);
  const sd = await s.json();
  console.log('Bookworm S2 IT:', s.status, '| episodi:', sd.episodes ? sd.episodes.length : 'ASSENTE');
  const ep = sd.episodes && sd.episodes.find((e) => e.episode_number === 19);
  if (ep) {
    console.log('E19 nome IT:', ep.name);
    console.log('trama IT len:', (ep.overview || '').length, '|', (ep.overview || '').slice(0, 120));
    if (!ep.overview) {
      const se = await fetch(`https://api.themoviedb.org/3/tv/91768/season/2?api_key=${KEY}&language=en-US`);
      const sed = await se.json();
      const epe = sed.episodes.find((x) => x.episode_number === 19);
      console.log('fallback EN len:', (epe.overview || '').length, '|', (epe.overview || '').slice(0, 120));
    }
  }
})().catch((e) => console.error('ERR:', e.message));
