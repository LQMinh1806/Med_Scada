import { useState, useCallback, useRef } from 'react';
import { STATIONS, PRIORITY } from '../../constants';

// =====================================================
// Direction constants for the LOOK elevator algorithm
// =====================================================
export const DIRECTION = {
  UP: 'UP',     // Increasing station index
  DOWN: 'DOWN', // Decreasing station index
  IDLE: 'IDLE', // Cabin is stationary, no active direction
};

// =====================================================
// Generate a lightweight unique ID for queue items
// =====================================================
let _queueSeq = 0;
function generateQueueId() {
  _queueSeq += 1;
  return `Q-${Date.now()}-${_queueSeq}`;
}

// =====================================================
// Resolve a stationId to its locationIndex on the rail
// =====================================================
function getStationIndex(stationId) {
  const station = STATIONS.find((s) => s.id === stationId);
  return station ? station.idx : -1;
}

// =====================================================
// Core scheduling algorithm — 2-layer evaluation
//
// Layer 1: STAT priority (absolute, FCFS)
// Layer 2: LOOK elevator algorithm (ROUTINE)
// =====================================================

/**
 * Evaluate the next task to execute from the queue.
 *
 * @param {number}   currentStationIndex  Current cabin locationIndex
 * @param {string}   currentDirection     'UP' | 'DOWN' | 'IDLE'
 * @param {Array}    queue                Array of queue items
 * @returns {{ task: object|null, nextDirection: string }}
 */
export function evaluateNextTask(currentStationIndex, currentDirection, queue) {
  if (!queue || queue.length === 0) {
    return { task: null, nextDirection: DIRECTION.IDLE };
  }

  // --------------------------------------------------
  // Layer 1: STAT — Absolute priority (FCFS ordering)
  // --------------------------------------------------
  const statTasks = queue
    .filter((item) => item.priority === PRIORITY.STAT)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (statTasks.length > 0) {
    const chosen = statTasks[0];
    const targetIdx = getStationIndex(chosen.stationId);
    let nextDirection = currentDirection;
    if (targetIdx > currentStationIndex) nextDirection = DIRECTION.UP;
    else if (targetIdx < currentStationIndex) nextDirection = DIRECTION.DOWN;
    // If targetIdx === currentStationIndex, keep direction unchanged
    return { task: chosen, nextDirection };
  }

  // --------------------------------------------------
  // Layer 2: LOOK elevator algorithm — ROUTINE tasks
  // --------------------------------------------------
  const routineTasks = queue
    .filter((item) => item.priority === PRIORITY.ROUTINE)
    .map((item) => ({
      ...item,
      _stationIdx: getStationIndex(item.stationId),
    }))
    // Exclude tasks whose station cannot be resolved
    .filter((item) => item._stationIdx >= 0);

  if (routineTasks.length === 0) {
    return { task: null, nextDirection: DIRECTION.IDLE };
  }

  // --- IDLE: pick the nearest station to decide initial direction ---
  if (currentDirection === DIRECTION.IDLE) {
    routineTasks.sort(
      (a, b) =>
        Math.abs(a._stationIdx - currentStationIndex) -
        Math.abs(b._stationIdx - currentStationIndex)
    );
    const nearest = routineTasks[0];
    let nextDirection;
    if (nearest._stationIdx > currentStationIndex) {
      nextDirection = DIRECTION.UP;
    } else if (nearest._stationIdx < currentStationIndex) {
      nextDirection = DIRECTION.DOWN;
    } else {
      // Task is at current position — stay IDLE direction-wise
      nextDirection = DIRECTION.IDLE;
    }
    return { task: nearest, nextDirection };
  }

  // --- UP: scan for tasks ahead (higher index) ---
  if (currentDirection === DIRECTION.UP) {
    const ahead = routineTasks
      .filter((item) => item._stationIdx > currentStationIndex)
      .sort((a, b) => a._stationIdx - b._stationIdx);

    if (ahead.length > 0) {
      return { task: ahead[0], nextDirection: DIRECTION.UP };
    }

    // No tasks ahead in UP → reverse to DOWN and re-evaluate
    const behind = routineTasks
      .filter((item) => item._stationIdx < currentStationIndex)
      .sort((a, b) => b._stationIdx - a._stationIdx);

    if (behind.length > 0) {
      return { task: behind[0], nextDirection: DIRECTION.DOWN };
    }

    // Tasks exist only at current index
    const atCurrent = routineTasks.filter(
      (item) => item._stationIdx === currentStationIndex
    );
    if (atCurrent.length > 0) {
      return { task: atCurrent[0], nextDirection: DIRECTION.IDLE };
    }
  }

  // --- DOWN: scan for tasks ahead (lower index) ---
  if (currentDirection === DIRECTION.DOWN) {
    const ahead = routineTasks
      .filter((item) => item._stationIdx < currentStationIndex)
      .sort((a, b) => b._stationIdx - a._stationIdx);

    if (ahead.length > 0) {
      return { task: ahead[0], nextDirection: DIRECTION.DOWN };
    }

    // No tasks ahead in DOWN → reverse to UP and re-evaluate
    const behind = routineTasks
      .filter((item) => item._stationIdx > currentStationIndex)
      .sort((a, b) => a._stationIdx - b._stationIdx);

    if (behind.length > 0) {
      return { task: behind[0], nextDirection: DIRECTION.UP };
    }

    // Tasks exist only at current index
    const atCurrent = routineTasks.filter(
      (item) => item._stationIdx === currentStationIndex
    );
    if (atCurrent.length > 0) {
      return { task: atCurrent[0], nextDirection: DIRECTION.IDLE };
    }
  }

  return { task: null, nextDirection: DIRECTION.IDLE };
}

// =====================================================
// React hook: useQueueScheduler
//
// Manages queue state and provides enqueue/dequeue
// operations along with the LOOK + STAT scheduler.
// =====================================================

export default function useQueueScheduler() {
  const [queue, setQueue] = useState([]);
  const [cabinDirection, setCabinDirection] = useState(DIRECTION.IDLE);

  // Ref mirrors for synchronous access inside animation callbacks
  const queueRef = useRef(queue);
  const directionRef = useRef(cabinDirection);

  // Keep refs in sync with state
  const syncQueueRef = useCallback((nextQueue) => {
    queueRef.current = nextQueue;
    setQueue(nextQueue);
  }, []);

  const syncDirectionRef = useCallback((nextDir) => {
    directionRef.current = nextDir;
    setCabinDirection(nextDir);
  }, []);

  // --------------------------------------------------
  // Enqueue a new task
  // --------------------------------------------------
  const enqueue = useCallback(
    (stationId, type, priority, metadata = null) => {
      const item = {
        id: generateQueueId(),
        stationId,
        type,       // 'CALL' | 'DISPATCH'
        priority,   // PRIORITY.STAT | PRIORITY.ROUTINE
        timestamp: Date.now(),
        metadata,
      };

      const nextQueue = [...queueRef.current, item];
      syncQueueRef(nextQueue);
      return item;
    },
    [syncQueueRef]
  );

  // --------------------------------------------------
  // Remove a specific task by ID (completed or cancelled)
  // --------------------------------------------------
  const removeFromQueue = useCallback(
    (taskId) => {
      const nextQueue = queueRef.current.filter((item) => item.id !== taskId);
      syncQueueRef(nextQueue);
    },
    [syncQueueRef]
  );

  // --------------------------------------------------
  // Cancel a specific queued task by ID
  // --------------------------------------------------
  const cancelQueueItem = useCallback(
    (taskId) => {
      removeFromQueue(taskId);
    },
    [removeFromQueue]
  );

  // --------------------------------------------------
  // Clear all tasks from the queue
  // --------------------------------------------------
  const clearQueue = useCallback(() => {
    syncQueueRef([]);
    syncDirectionRef(DIRECTION.IDLE);
  }, [syncQueueRef, syncDirectionRef]);

  // --------------------------------------------------
  // Replace the entire queue (used by cross-tab sync)
  // --------------------------------------------------
  const replaceQueue = useCallback(
    (nextQueue, nextDirection) => {
      syncQueueRef(Array.isArray(nextQueue) ? nextQueue : []);
      if (nextDirection && Object.values(DIRECTION).includes(nextDirection)) {
        syncDirectionRef(nextDirection);
      }
    },
    [syncQueueRef, syncDirectionRef]
  );

  // --------------------------------------------------
  // Peek at the next task without removing it
  // --------------------------------------------------
  const peekNextTask = useCallback(
    (currentStationIndex) => {
      return evaluateNextTask(
        currentStationIndex,
        directionRef.current,
        queueRef.current
      );
    },
    []
  );

  // --------------------------------------------------
  // Dequeue: evaluate, remove, and return the next task
  // --------------------------------------------------
  const dequeueNextTask = useCallback(
    (currentStationIndex) => {
      const { task, nextDirection } = evaluateNextTask(
        currentStationIndex,
        directionRef.current,
        queueRef.current
      );

      if (task) {
        const nextQueue = queueRef.current.filter((item) => item.id !== task.id);
        syncQueueRef(nextQueue);
      }

      syncDirectionRef(nextDirection);
      return task;
    },
    [syncQueueRef, syncDirectionRef]
  );

  return {
    // State (read-only for consumers)
    queue,
    cabinDirection,

    // Refs for synchronous access in callbacks
    queueRef,
    directionRef,

    // Mutations
    enqueue,
    removeFromQueue,
    cancelQueueItem,
    clearQueue,
    replaceQueue,

    // Scheduler
    peekNextTask,
    dequeueNextTask,
    syncDirectionRef,
  };
}
