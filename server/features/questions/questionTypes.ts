export interface QuestionOption {
  label: string;
  description: string;
  preview?: string;
}

export interface StructuredQuestion {
  question: string;
  header: string;
  multiSelect?: boolean;
  options: QuestionOption[];
}

export interface QuestionParams {
  questions: StructuredQuestion[];
}

/** One answer per question, index-aligned with `QuestionParams.questions`. */
export interface QuestionAnswer {
  selected: string[];
  customText?: string;
}

export interface QuestionnaireResult {
  cancelled: boolean;
  answers: QuestionAnswer[];
}

export interface DanglingQuestion {
  toolCallId: string;
  params: QuestionParams;
}
