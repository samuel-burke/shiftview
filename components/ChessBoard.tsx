"use client";

import { useState } from "react";
import { Chessboard } from "react-chessboard";
import type { PieceDropHandlerArgs } from "react-chessboard";
import { Chess } from "chess.js";

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export type ChessMessage = {
  fen: string;
  white: string;
  black: string;
  status: "active" | "white_wins" | "black_wins" | "draw";
};

export function parseChessMessage(body: string): ChessMessage | null {
  try {
    const parsed = JSON.parse(body);
    if (parsed._chess === true && parsed.fen && parsed.white && parsed.black && parsed.status)
      return parsed as ChessMessage;
  } catch {}
  return null;
}

type Props = {
  myUserId: string;
  otherName: string;
  game: ChessMessage;
  onSend: (body: string) => Promise<void>;
};

export default function ChessBoard({ myUserId, otherName, game, onSend }: Props) {
  const [moving, setMoving] = useState(false);

  const amWhite = myUserId === game.white;
  const chess = new Chess(game.fen);
  const turn = chess.turn();
  const isMyTurn = game.status === "active" && ((turn === "w" && amWhite) || (turn === "b" && !amWhite));
  const isOver = game.status !== "active";

  async function sendGameState(newChess: Chess, status: ChessMessage["status"]) {
    const msg: ChessMessage & { _chess: true } = {
      _chess: true,
      fen: newChess.fen(),
      white: game.white,
      black: game.black,
      status,
    };
    await onSend(JSON.stringify(msg));
  }

  function onDrop({ sourceSquare, targetSquare, piece }: PieceDropHandlerArgs): boolean {
    if (!isMyTurn || moving || !targetSquare) return false;

    const attempt = new Chess(game.fen);
    const pieceType = piece.pieceType;
    const isPromotion =
      pieceType[1] === "P" &&
      ((pieceType[0] === "w" && targetSquare[1] === "8") ||
        (pieceType[0] === "b" && targetSquare[1] === "1"));

    let result;
    try {
      result = attempt.move({ from: sourceSquare, to: targetSquare, promotion: isPromotion ? "q" : undefined });
    } catch {
      return false;
    }
    if (!result) return false;

    let status: ChessMessage["status"] = "active";
    if (attempt.isCheckmate()) status = amWhite ? "white_wins" : "black_wins";
    else if (attempt.isDraw() || attempt.isStalemate() || attempt.isThreefoldRepetition() || attempt.isInsufficientMaterial()) status = "draw";

    setMoving(true);
    sendGameState(attempt, status).finally(() => setMoving(false));
    return true;
  }

  async function handleResign() {
    if (isOver || moving) return;
    const c = new Chess(game.fen);
    setMoving(true);
    await sendGameState(c, amWhite ? "black_wins" : "white_wins");
    setMoving(false);
  }

  function statusMessage() {
    if (game.status === "white_wins") return (amWhite ? game.white : game.black) === myUserId ? "You won! 🎉" : `${otherName} won`;
    if (game.status === "black_wins") return (!amWhite ? game.black : game.white) === myUserId ? "You won! 🎉" : `${otherName} won`;
    if (game.status === "draw") return "Draw";
    if (isMyTurn) return chess.inCheck() ? "Your turn — you're in check!" : "Your turn";
    return chess.inCheck() ? `${otherName}'s turn — they're in check` : `${otherName}'s turn…`;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <div className={`text-xs font-medium ${
          isOver ? "text-slate-400" : isMyTurn ? "text-emerald-400" : "text-slate-400"
        }`}>
          {statusMessage()}
        </div>
        {!isOver && (
          <button
            onClick={handleResign}
            disabled={moving}
            className="text-[11px] text-slate-500 hover:text-red-400 transition-colors disabled:opacity-40"
          >
            Resign
          </button>
        )}
      </div>

      <div className="rounded-xl overflow-hidden border border-slate-700/50">
        <Chessboard
          options={{
            position: game.fen === "" ? STARTING_FEN : game.fen,
            onPieceDrop: onDrop,
            boardOrientation: amWhite ? "white" : "black",
            allowDragging: isMyTurn && !moving,
            boardStyle: { borderRadius: 0 },
            darkSquareStyle: { backgroundColor: "#3b4a6b" },
            lightSquareStyle: { backgroundColor: "#e8edf5" },
          }}
        />
      </div>

      <div className="flex justify-between text-[11px] text-slate-500 px-1">
        <span>{amWhite ? "You (white)" : `${otherName} (white)`}</span>
        <span>{amWhite ? `${otherName} (black)` : "You (black)"}</span>
      </div>
    </div>
  );
}
