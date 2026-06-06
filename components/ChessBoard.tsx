"use client";

import { useState, useEffect, useRef } from "react";
import { Chessboard } from "react-chessboard";
import type { PieceDropHandlerArgs } from "react-chessboard";
import { Chess, type Square } from "chess.js";
import { playMove, playCapture, playCastle, playCheck, playWin, playLose, playDraw } from "@/lib/chess-sounds";

export type ChessMessage = {
  fen: string;
  white: string;
  black: string;
  status: "active" | "white_wins" | "black_wins" | "draw";
  lastMoveFlags?: string; // chess.js move flags: c=capture, k/q=castle, e=en passant, p=promotion
};

export function parseChessMessage(body: string): ChessMessage | null {
  try {
    const parsed = JSON.parse(body);
    if (parsed._chess === true && parsed.fen && parsed.white && parsed.black && parsed.status)
      return parsed as ChessMessage;
  } catch {}
  return null;
}

function soundForMove(flags: string | undefined, inCheck: boolean, status: ChessMessage["status"], amWhite: boolean) {
  if (status === "white_wins" || status === "black_wins") {
    const iWon = (status === "white_wins" && amWhite) || (status === "black_wins" && !amWhite);
    return iWon ? playWin : playLose;
  }
  if (status === "draw") return playDraw;
  if (inCheck) return playCheck;
  if (!flags) return playMove;
  if (flags.includes("k") || flags.includes("q")) return playCastle;
  if (flags.includes("c") || flags.includes("e")) return playCapture;
  return playMove;
}

type Props = {
  myUserId: string;
  otherName: string;
  game: ChessMessage;
  onSend: (body: string) => Promise<void>;
};

export default function ChessBoard({ myUserId, otherName, game, onSend }: Props) {
  // displayFen is updated optimistically on my moves, and via prop sync on opponent's moves
  const [displayFen, setDisplayFen] = useState(game.fen);
  const [displayStatus, setDisplayStatus] = useState(game.status);
  const [moving, setMoving] = useState(false);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [legalSquares, setLegalSquares] = useState<Square[]>([]);
  const prevFenRef = useRef(game.fen);
  const isFirstRender = useRef(true);

  // Sync prop → display state (opponent's moves arrive this way)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (game.fen !== prevFenRef.current) {
      prevFenRef.current = game.fen;
      setDisplayFen(game.fen);

      // Only play sound when it's now OUR turn — meaning the opponent just
      // moved. If the new FEN shows it's the opponent's turn, that means WE
      // just moved; the immediate sound already played in onDrop/onSquareClick,
      // so skip here to avoid a double-play when the same window has a second
      // open message thread or the Realtime echo arrives on a duplicate channel.
      const chess = new Chess(game.fen);
      const isMyTurnNow = game.status === "active"
        ? (amWhite ? chess.turn() === "w" : chess.turn() === "b")
        : true; // game-over moves always warrant a sound
      if (isMyTurnNow) {
        const sfx = soundForMove(game.lastMoveFlags, chess.inCheck(), game.status, amWhite);
        sfx();
      }
    }
    // Always sync status — resignation and new-game both change status without changing FEN
    setDisplayStatus(game.status);
  }, [game.fen, game.status, game.lastMoveFlags, myUserId, game.white]);

  const amWhite = myUserId === game.white;
  const chess = new Chess(displayFen);
  const turn = chess.turn();
  const isMyTurn = displayStatus === "active" && ((turn === "w" && amWhite) || (turn === "b" && !amWhite));
  const isOver = displayStatus !== "active";

  function sendGameState(attempt: Chess, status: ChessMessage["status"], flags: string) {
    const msg: ChessMessage & { _chess: true } = {
      _chess: true,
      fen: attempt.fen(),
      white: game.white,
      black: game.black,
      status,
      lastMoveFlags: flags,
    };
    onSend(JSON.stringify(msg));
  }

  function onDrop({ sourceSquare, targetSquare, piece }: PieceDropHandlerArgs): boolean {
    if (!isMyTurn || moving || !targetSquare) return false;

    const attempt = new Chess(displayFen);
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

    // Optimistic update — board moves immediately
    const newFen = attempt.fen();
    prevFenRef.current = newFen;
    setDisplayFen(newFen);
    setDisplayStatus(status);

    // Play my move sound immediately
    const sfx = soundForMove(result.flags, attempt.inCheck(), status, amWhite);
    sfx();

    setSelectedSquare(null);
    setLegalSquares([]);
    setMoving(true);
    sendGameState(attempt, status, result.flags);
    setMoving(false);

    return true;
  }

  function onSquareClick({ square: squareStr }: { square: string; piece?: unknown }) {
    const square = squareStr as Square;
    if (isOver || moving) return;

    const chess = new Chess(displayFen);

    // Toggle off if clicking the already-selected piece
    if (selectedSquare === square) {
      setSelectedSquare(null);
      setLegalSquares([]);
      return;
    }

    // If it's my turn and clicking a legal target square — execute the move
    if (isMyTurn && selectedSquare && legalSquares.includes(square)) {
      const attempt = new Chess(displayFen);
      const pieceType = attempt.get(selectedSquare)?.type;
      const isPromotion = pieceType === "p" && (square[1] === "8" || square[1] === "1");
      let result;
      try {
        result = attempt.move({ from: selectedSquare, to: square, promotion: isPromotion ? "q" : undefined });
      } catch {
        setSelectedSquare(null);
        setLegalSquares([]);
        return;
      }
      if (!result) { setSelectedSquare(null); setLegalSquares([]); return; }

      let status: ChessMessage["status"] = "active";
      if (attempt.isCheckmate()) status = amWhite ? "white_wins" : "black_wins";
      else if (attempt.isDraw() || attempt.isStalemate() || attempt.isThreefoldRepetition() || attempt.isInsufficientMaterial()) status = "draw";

      const newFen = attempt.fen();
      prevFenRef.current = newFen;
      setDisplayFen(newFen);
      setDisplayStatus(status);
      setSelectedSquare(null);
      setLegalSquares([]);
      soundForMove(result.flags, attempt.inCheck(), status, amWhite)();
      setMoving(true);
      sendGameState(attempt, status, result.flags);
      setMoving(false);
      return;
    }

    // Select any of my pieces to preview legal moves (works on both turns)
    const piece = chess.get(square);
    const myColor = amWhite ? "w" : "b";
    if (piece && piece.color === myColor) {
      const moves = chess.moves({ square, verbose: true });
      setSelectedSquare(square);
      setLegalSquares(moves.map((m) => m.to));
    } else {
      setSelectedSquare(null);
      setLegalSquares([]);
    }
  }

  async function handleResign() {
    if (isOver || moving) return;
    setMoving(true);
    const status = amWhite ? "black_wins" : "white_wins";
    const msg: ChessMessage & { _chess: true } = {
      _chess: true,
      fen: displayFen,
      white: game.white,
      black: game.black,
      status,
    };
    playLose();
    await onSend(JSON.stringify(msg));
    setMoving(false);
  }

  function statusMessage() {
    if (displayStatus === "white_wins") return myUserId === game.white ? "You won! 🎉" : `${otherName} won`;
    if (displayStatus === "black_wins") return myUserId === game.black ? "You won! 🎉" : `${otherName} won`;
    if (displayStatus === "draw") return "Draw ½–½";
    if (isMyTurn) return chess.inCheck() ? "Your turn — you're in check!" : "Your turn";
    return chess.inCheck() ? `${otherName} is in check` : `${otherName}'s turn…`;
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
            position: displayFen,
            onPieceDrop: onDrop,
            onSquareClick,
            boardOrientation: amWhite ? "white" : "black",
            allowDragging: isMyTurn && !moving,
            showAnimations: true,
            animationDurationInMs: 150,
            boardStyle: { borderRadius: 0 },
            darkSquareStyle: { backgroundColor: "#3b4a6b" },
            lightSquareStyle: { backgroundColor: "#e8edf5" },
            squareStyles: {
              ...(selectedSquare
                ? { [selectedSquare]: { backgroundColor: "rgba(99,102,241,0.5)" } }
                : {}),
              ...Object.fromEntries(
                legalSquares.map((sq) => {
                  const hasPiece = !!new Chess(displayFen).get(sq);
                  return [
                    sq,
                    hasPiece
                      ? { boxShadow: "inset 0 0 0 3px rgba(99,102,241,0.7)" }
                      : {
                          backgroundImage: "radial-gradient(circle, rgba(99,102,241,0.55) 28%, transparent 30%)",
                        },
                  ];
                })
              ),
            },
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
