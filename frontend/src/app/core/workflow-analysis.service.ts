import {Injectable} from '@angular/core';
import {WorkflowEngine} from '../../scanner-core/workflow-engine';

@Injectable({providedIn: 'root'})
export class WorkflowAnalysisService extends WorkflowEngine {}
