(function (WG) {
  'use strict';

  WG.themes = {
    neon: {
      bg: '#0b0b12', grid: 'rgba(255,255,255,0.05)', dot: 'rgba(255,255,255,0.12)',
      palette: ['#ff4d6d', '#ffb703', '#52e3a4', '#3ec5ff', '#a78bfa', '#ff8fab', '#f9f871', '#4ade80'],
      glow: true, style: 'neon', text: '#ffffff',
    },
    wool: {
      bg: '#f3e9dc', grid: 'rgba(120,90,60,0.08)', dot: 'rgba(120,90,60,0.18)',
      palette: ['#e76f51', '#f4a261', '#2a9d8f', '#457b9d', '#9b5de5', '#e9c46a', '#d62828', '#6a994e'],
      glow: false, style: 'wool', text: '#4a3426',
    },
  };

})(window.WG = window.WG || {});
