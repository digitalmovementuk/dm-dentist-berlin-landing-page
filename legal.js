(()=>{
  const body=document.body;
  const header=document.querySelector('.site-header');
  const menu=document.querySelector('.nav-links');
  const toggle=document.querySelector('.menu-btn');
  const progress=document.querySelector('.scroll-progress span');
  const sections=[...document.querySelectorAll('.legal-section[id]')];
  const tocLinks=[...document.querySelectorAll('.legal-toc a')];
  let frame=0;

  const closeMenu=()=>{
    if(!menu||!toggle)return;
    menu.classList.remove('open');
    body.classList.remove('menu-open');
    toggle.setAttribute('aria-expanded','false');
    toggle.setAttribute('aria-label','Menü öffnen');
  };

  if(menu&&toggle){
    toggle.addEventListener('click',()=>{
      const open=menu.classList.toggle('open');
      body.classList.toggle('menu-open',open);
      toggle.setAttribute('aria-expanded',String(open));
      toggle.setAttribute('aria-label',open?'Menü schließen':'Menü öffnen');
    });
    menu.querySelectorAll('a').forEach(link=>link.addEventListener('click',closeMenu));
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.classList.contains('open')){closeMenu();toggle.focus()}});
  }

  const update=()=>{
    const distance=Math.max(1,document.documentElement.scrollHeight-innerHeight);
    if(progress)progress.style.transform=`scaleX(${Math.min(1,scrollY/distance)})`;
    if(header)header.classList.toggle('scrolled',scrollY>12);
    let current='';
    sections.forEach(section=>{if(section.getBoundingClientRect().top<innerHeight*.42)current=section.id});
    tocLinks.forEach(link=>link.classList.toggle('active',link.hash===`#${current}`));
  };

  addEventListener('scroll',()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(update)},{passive:true});
  addEventListener('resize',update,{passive:true});
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('visible');observer.unobserve(entry.target)}}),{threshold:.08,rootMargin:'0px 0px -30px'});
  document.querySelectorAll('.reveal').forEach(element=>observer.observe(element));
  update();

  /* Theme toggle — same localStorage key as the homepage, so a visitor's
     manual choice follows them across the homepage and the legal pages. */
  (()=>{
    const KEY='dm-dental-theme';
    const root=document.documentElement;
    const themeToggle=document.querySelector('[data-theme-toggle]');
    const autoTheme=()=>{const h=new Date().getHours();return(h>=6&&h<20)?'light':'dark'};
    const applyLabel=theme=>{
      if(!themeToggle)return;
      themeToggle.setAttribute('aria-pressed',theme==='dark'?'true':'false');
      themeToggle.setAttribute('aria-label',theme==='dark'?'Helles Design einschalten':'Dunkles Design einschalten');
    };
    applyLabel(root.getAttribute('data-theme'));
    if(themeToggle){
      themeToggle.addEventListener('click',()=>{
        const next=root.getAttribute('data-theme')==='dark'?'light':'dark';
        root.setAttribute('data-theme',next);
        applyLabel(next);
        try{localStorage.setItem(KEY,next)}catch(e){}
      });
    }
    setInterval(()=>{
      let saved=null;
      try{saved=localStorage.getItem(KEY)}catch(e){}
      if(saved==='light'||saved==='dark')return;
      const theme=autoTheme();
      if(root.getAttribute('data-theme')!==theme){root.setAttribute('data-theme',theme);applyLabel(theme)}
    },5*60*1000);
  })();
})();
