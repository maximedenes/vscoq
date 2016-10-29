import * as textUtil from './text-util'
import {Position, Range} from 'vscode-languageserver';
import * as vscode from 'vscode-languageserver';
import {SentenceSemantics} from './parsing/SentenceSemantics';
import {State} from './STMState'
import * as parser from './parsing/coq-parser';

export class Sentence {
  private state: State = undefined;

  public constructor(
    private text: string,
    private documentRange: Range,
    private documentOffset: number,
    private symbols?: vscode.SymbolInformation[],
  ) {}

  public dispose() {

  }

  public getState() : State {
    return this.state;
  }

  public setState(state: State) : void {
    this.state = state;
  }

  public getText() : string {
    return this.text;
  }

  public getRange() : Range {
    return this.documentRange;
  }

  public getDocumentOffset() : number {
    return this.documentOffset;
  }

  public getDocumentEndOffset() : number {
    return this.documentOffset + this.text.length;
  }

  /**
   * @param localOffset -- character offset into this sentence
   * @return the position w.r.t. the whole document
   */
  public positionAt(localOffset: number) : Position {
    return textUtil.positionAtRelative(this.documentRange.start, this.text, localOffset);
  }

  /**
   * @param position -- position w.r.t. the whole document
   * @return the offset w.r.t. this sentence, or -1 if the position is not contained by this sentence
   */
  public offsetAt(position: Position) : number {
    return textUtil.relativeOffsetAtAbsolutePosition(this.text, this.documentRange.start, position);
  }

  /**
   * @param position -- position w.r.t. the whole document
   * @return the offset w.r.t. this sentence, or -1 if the position is not contained by this sentence
   */
  public documentOffsetAt(position: Position) : number {
    return this.documentOffset + textUtil.relativeOffsetAtAbsolutePosition(this.text, this.documentRange.start, position);
  }

  public contains(position: Position) : boolean {
    return textUtil.rangeContains(this.documentRange, position);
  }

  public intersects(range: Range) : boolean {
    return textUtil.rangeIntersects(this.documentRange, range);
  }

  /** @returns `true` if this sentence appears strictly before `position` */
  public isBefore(position: Position) : boolean {
    return textUtil.positionIsBeforeOrEqual(this.documentRange.end, position);
  }

  /** @returns `true` if this sentence appears before or contains `position` */
  public isBeforeOrAt(position: Position) : boolean {
    return textUtil.positionIsBeforeOrEqual(this.documentRange.end, position) || textUtil.positionIsBeforeOrEqual(this.documentRange.start, position);
  }

  /** @returns `true` if this sentence appears strictly after `position`. */
  public isAfter(position: Position) : boolean {
    return textUtil.positionIsAfter(this.documentRange.start, position);
  }

  /** @returns `true` if this sentence appears after or contains `position`. */
  public isAfterOrAt(position: Position) : boolean {
    return textUtil.positionIsAfterOrEqual(this.documentRange.start, position) ||
      textUtil.positionIsAfter(this.documentRange.end, position);
  }

  /** @returns the position of this sentence relative to `position` */
  public comparePosition(position: Position) : ("before"|"after"|"contains") {
    if(textUtil.positionIsBeforeOrEqual(this.documentRange.end, position))
      return "before";
    else if(textUtil.positionIsAfter(this.documentRange.start, position))
      return "after";
    else
      return "contains";
  }

  public getSymbols() {
    return this.symbols;
  }

  // public addSemantics(sem: SentenceSemantics) {
  //   if(this.semantics) {
  //     if (this.semantics.every((x) => !x.isEqual(sem)))
  //       this.semantics.push(sem);
  //   } else
  //     this.semantics = [sem];
  // }

  // public *getSemantics() : Iterable<SentenceSemantics> {
  //   if(this.semantics)
  //     yield* this.semantics;
  // }

  public toString() : string {
    return this.text;
  }

  private invalidate() : void {
    if(this.state)
      this.state.markInvalid();
  }

  /**
   * Applies the textual changes to the sentence
   * @return false if the change has invalidated the sentence; true if preserved
   */
  public applyTextChanges(changes: vscode.TextDocumentContentChangeEvent[], deltas: textUtil.RangeDelta[], updatedDocumentText: string) : boolean {
    let newText = this.text;
    let newRange = this.documentRange;
    let newErrorRange = undefined;
    let touchesEnd = false; // indicates whether a change has touched the end of this sentence
    change: for(let idx = 0; idx < changes.length; ++ idx) {
      const change = changes[idx];
      const delta = deltas[idx];
      switch(parser.sentenceRangeContainment(newRange,change.range)) {
        case parser.SentenceRangeContainment.Before:
          this.documentOffset+= change.text.length - change.rangeLength;
          newRange = textUtil.rangeDeltaTranslate(newRange,delta);
          if(newErrorRange)
            newErrorRange = textUtil.rangeDeltaTranslate(newErrorRange,delta);
          continue change;
        case parser.SentenceRangeContainment.After:
          if(textUtil.positionIsEqual(newRange.end, change.range.start))
            touchesEnd = true;
          continue change; // ignore this change
        case parser.SentenceRangeContainment.Crosses:
          this.invalidate();
          return false; // give up; this sentence is toast (invalidated; needs to be cancelled)
        case parser.SentenceRangeContainment.Contains:
          // the change falls within this sentence
          const beginOffset = textUtil.relativeOffsetAtAbsolutePosition(newText, newRange.start, change.range.start);
          if(beginOffset == -1)
            continue change;
          newText =
            newText.substring(0,beginOffset)
            + change.text
            + newText.substring(beginOffset+change.rangeLength);
          newRange.end = textUtil.positionRangeDeltaTranslateEnd(newRange.end,delta);
      } // switch
    } // change: for


    if(touchesEnd) {
      // We need to reparse the sentence to make sure the end of the sentence has not changed
      const endOffset = textUtil.offsetAt(updatedDocumentText, newRange.end);
      // The problem is if a non-blank [ \r\n] is now contacting the end-period of this sentence; we need only check one more character
      const newEnd = parser.parseSentenceLength(newText + updatedDocumentText.substr(endOffset, 1));
      if(newEnd === -1 || newEnd !== newText.length) {
        this.invalidate();
        return false; // invalidate: bad or changed syntax
      }   
    }
    
    if(parser.isPassiveDifference(this.text, newText)) {
      this.text = newText;
      this.documentRange = newRange;
      return true;
    } else
      this.invalidate();
      return false;
  }

}