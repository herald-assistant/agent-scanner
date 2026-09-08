import {Routes} from '@angular/router';

const scannerShell = () => import('./app.component').then(module => module.AppComponent);
const homePage = () => import('./features/home/home-page.component').then(module => module.HomePageComponent);
const sessionPage = () => import('./features/session/session-page.component').then(module => module.SessionPageComponent);

export const appRoutes: Routes = [
  {
    path: '',
    loadComponent: scannerShell,
    children: [
      {path: '', pathMatch: 'full', loadComponent: homePage, title: 'Agent Scanner'},
      {path: 'sessions/:sessionId', loadComponent: sessionPage, title: 'Sesja · Agent Scanner'}
    ]
  },
  {path: '**', redirectTo: ''}
];
