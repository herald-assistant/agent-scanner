import {Injectable} from '@angular/core';
import {SessionEngine} from '../../scanner-core/session-engine';

@Injectable({providedIn: 'root'})
export class SessionAnalysisService extends SessionEngine {}
