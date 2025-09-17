

const NET_SIZE = 300;
const COLS = 40;
const ROWS = 40;
const SPACING = NET_SIZE / (COLS - 1);

// physics constants
const GRAVITY = 0.5;
const K_BORDER = 1;
const K_CENTER = 1;
const DAMPING = 0.96;

const MAX_SAFE_K = 1.0;
const MAX_VELOCITY = 1.8;
const ADAPTIVE_DAMPING_FACTOR = 0.02;

const SMOOTHING_FACTOR = 0.35;
const VIBRATION_DETECTION_FRAMES = 8;
const HIGH_FREQ_THRESHOLD = 0.2;

function getSafeKBorder() {
    const theoreticalLimit = 0.6;
    const desiredK = K_BORDER;
    return min(desiredK, theoreticalLimit);
}

const WIND_FORCE = 2;
const WIND_ANGLE_DEG = -40; // <<< 调整这里即可改变风向角度 (0=向右, 90=向下)

// 颜色控制参数
const BACKGROUND_COLOR = [65, 10, 235];           // 背景颜色 
const GRID_COLOR = [255, 250, 240, 140];           // 网格线颜色 
const FONT_COLOR_GRID = [255, 250, 240, 220];         // 网格字母颜色 
const FONT_COLOR_DROPPED = [255, 250, 240, 160];     // 掉落字母颜色 

// drop controls
const DROP_LIMIT_RATIO = 0.3;
const DROP_MARGIN = 100;
const BASE_DROP_RATE = 70;   // 每秒最大掉落字母数 (风力=1 时)

const WIND_DELAY_FRAMES = 60;
const WIND_RAMP_FRAMES = 100;

const WIND_DECAY_START_RATIO = 0.7;
const MIN_WIND_STRENGTH = 0.15;
const WIND_DECAY_FRAMES = 120;

let letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
let gridChar = [], gridStatus = [];
let pos = [], vel = [], acc = [];
let dropped = [];

let velHistory = [];
let smoothedVel = [];
let vibrationLevel = [];

let totalDroppable, maxDrops, dropCount = 0;
let windDir, t = 0;
let dropAccum = 0;

function setup() {
    createCanvas(windowWidth, windowHeight);
    textAlign(CENTER, CENTER);
    textSize(8);

    windDir = p5.Vector.fromAngle(radians(WIND_ANGLE_DEG));

    for (let x = 0; x < COLS; x++) {
        gridChar[x] = [];
        gridStatus[x] = [];
        pos[x] = [];
        vel[x] = [];
        acc[x] = [];
        velHistory[x] = [];
        smoothedVel[x] = [];
        vibrationLevel[x] = [];
        for (let y = 0; y < ROWS; y++) {
            gridChar[x][y] = random(letters);
            gridStatus[x][y] = true;
            pos[x][y] = createVector(x * SPACING, y * SPACING);
            vel[x][y] = createVector(0, 0);
            acc[x][y] = createVector(0, 0);
            velHistory[x][y] = [];
            smoothedVel[x][y] = createVector(0, 0);
            vibrationLevel[x][y] = 0;
        }
    }
    totalDroppable = COLS * ROWS;
    maxDrops = floor(totalDroppable * DROP_LIMIT_RATIO);
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); }

function draw() {
    background(BACKGROUND_COLOR[0], BACKGROUND_COLOR[1], BACKGROUND_COLOR[2]);

    windDir = p5.Vector.fromAngle(radians(WIND_ANGLE_DEG));

    const windActive = frameCount > WIND_DELAY_FRAMES;
    const windElapsed = constrain(frameCount - WIND_DELAY_FRAMES, 0, WIND_RAMP_FRAMES);
    let baseWindStrength = windActive ? windElapsed / WIND_RAMP_FRAMES : 0;


    const dropRatio = dropCount / maxDrops;
    let windDecayFactor = 1.0;

    if (dropRatio >= WIND_DECAY_START_RATIO) {

        const decayProgress = (dropRatio - WIND_DECAY_START_RATIO) / (1.0 - WIND_DECAY_START_RATIO);
        const smoothDecay = 1 - pow(decayProgress, 2);
        windDecayFactor = lerp(MIN_WIND_STRENGTH, 1.0, smoothDecay);
    }

    const windStrength = baseWindStrength * windDecayFactor;


    const isWindDecayComplete = dropRatio >= WIND_DECAY_START_RATIO &&
        windDecayFactor <= MIN_WIND_STRENGTH + 0.001;


    const shouldApplyVibrationControl = isWindDecayComplete;

    if (windActive) t += 0.003;


    for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++) acc[x][y].set(0, 0);

    const maxBorderDist = dist(0, 0, (COLS - 1) / 2, (ROWS - 1) / 2);

    // WIND & GRAVITY forces
    if (windActive) {
        for (let x = 0; x < COLS; x++) {
            for (let y = 0; y < ROWS; y++) {
                if (!isMovable(x, y)) continue;
                const radialFactor = 1 - pow(dist(x, y, (COLS - 1) / 2, (ROWS - 1) / 2) / maxBorderDist, 2);

                const n = noise(x * 0.12, y * 0.12, t * 0.6) * 0.6 + 0.6;
                const windF = p5.Vector.mult(windDir, WIND_FORCE * windStrength * radialFactor * n);
                acc[x][y].add(windF);
                acc[x][y].y += GRAVITY;
            }
        }
    } else {

        for (let x = 0; x < COLS; x++) {
            for (let y = 0; y < ROWS; y++) {
                if (!isMovable(x, y)) continue;
                acc[x][y].y += GRAVITY;
            }
        }
    }

    // SPRING forces with stability control
    for (let x = 0; x < COLS; x++) {
        for (let y = 0; y < ROWS; y++) {
            const centerFactor = 1 - pow(dist(x, y, (COLS - 1) / 2, (ROWS - 1) / 2) / maxBorderDist, 2);

            const safeKBorder = getSafeKBorder();
            let kLocal = lerp(safeKBorder, K_CENTER, centerFactor);


            kLocal = min(kLocal, MAX_SAFE_K);

            if (x < COLS - 1 && gridStatus[x][y] && gridStatus[x + 1][y]) springInteraction(x, y, x + 1, y, kLocal);
            if (y < ROWS - 1 && gridStatus[x][y] && gridStatus[x][y + 1]) springInteraction(x, y, x, y + 1, kLocal);
        }
    }

    for (let x = 0; x < COLS; x++) {
        for (let y = 0; y < ROWS; y++) {
            if (!isMovable(x, y)) continue;

            vel[x][y].add(acc[x][y]);

            let velocity_magnitude = vel[x][y].mag();
            if (velocity_magnitude > MAX_VELOCITY) {
                vel[x][y].mult(MAX_VELOCITY / velocity_magnitude);
                velocity_magnitude = MAX_VELOCITY;
            }

            velHistory[x][y].push(vel[x][y].copy());
            if (velHistory[x][y].length > VIBRATION_DETECTION_FRAMES) {
                velHistory[x][y].shift();
            }

            if (shouldApplyVibrationControl && velHistory[x][y].length >= VIBRATION_DETECTION_FRAMES) {
                vibrationLevel[x][y] = detectVibrationLevel(x, y);

                if (vibrationLevel[x][y] > HIGH_FREQ_THRESHOLD) {
                    smoothedVel[x][y] = applyLowPassFilter(x, y);
                    vel[x][y] = smoothedVel[x][y].copy();
                } else {
                    smoothedVel[x][y].mult(1 - SMOOTHING_FACTOR * 0.3);
                    smoothedVel[x][y].add(p5.Vector.mult(vel[x][y], SMOOTHING_FACTOR * 0.3));
                    vel[x][y] = smoothedVel[x][y].copy();
                }
            } else {
                smoothedVel[x][y] = vel[x][y].copy();
            }

            const speedFactor = min(velocity_magnitude / MAX_VELOCITY, 1.0);
            const adaptiveDamping = DAMPING - (ADAPTIVE_DAMPING_FACTOR * speedFactor);
            vel[x][y].mult(max(adaptiveDamping, 0.8));

            pos[x][y].add(vel[x][y]);
        }
    }

    // wind‑dependent drop rate
    if (windActive && dropCount < maxDrops) {
        const dropsPerFrame = (BASE_DROP_RATE * windStrength) / 60.0;
        dropAccum += dropsPerFrame;
        while (dropAccum >= 1 && dropCount < maxDrops) {
            if (attemptDrop()) dropAccum -= 1;
            else break; // if failed to drop (e.g., connectivity), exit to avoid infinite loop
        }
    }

    const offsetX = (width - NET_SIZE) / 2;
    const offsetY = (height - NET_SIZE) / 2;

    // DRAW net
    push();
    translate(offsetX, offsetY);
    stroke(GRID_COLOR[0], GRID_COLOR[1], GRID_COLOR[2], GRID_COLOR[3]);
    for (let x = 0; x < COLS; x++) {
        for (let y = 0; y < ROWS; y++) {
            if (!gridStatus[x][y]) continue;
            const p = pos[x][y];
            if (x > 0 && gridStatus[x - 1][y]) line(p.x, p.y, pos[x - 1][y].x, pos[x - 1][y].y);
            if (y > 0 && gridStatus[x][y - 1]) line(p.x, p.y, pos[x][y - 1].x, pos[x][y - 1].y);
        }
    }
    noStroke();
    fill(FONT_COLOR_GRID[0], FONT_COLOR_GRID[1], FONT_COLOR_GRID[2], FONT_COLOR_GRID[3]);
    for (let x = 0; x < COLS; x++) for (let y = 0; y < ROWS; y++) if (gridStatus[x][y]) text(gridChar[x][y], pos[x][y].x, pos[x][y].y);
    pop();

    // UPDATE & DRAW dropped letters
    for (let i = dropped.length - 1; i >= 0; i--) {
        const d = dropped[i];


        if (windActive && windStrength > 0) {
            d.vel.add(p5.Vector.mult(windDir, 0.05 * windStrength));
        }


        d.vel.y += GRAVITY * 0.15;




        d.vel.mult(DAMPING + 0.02);
        d.pos.add(d.vel);

        push();
        translate(d.pos.x, d.pos.y);
        rotate(d.rot);
        fill(FONT_COLOR_DROPPED[0], FONT_COLOR_DROPPED[1], FONT_COLOR_DROPPED[2], FONT_COLOR_DROPPED[3]);
        text(d.char, 0, 0);
        pop();

        if (d.pos.x < -DROP_MARGIN || d.pos.x > width + DROP_MARGIN || d.pos.y < -DROP_MARGIN || d.pos.y > height + DROP_MARGIN) dropped.splice(i, 1);
        d.rot += 0.02;
    }
}

function springInteraction(x1, y1, x2, y2, k) {
    const p1 = pos[x1][y1];
    const p2 = pos[x2][y2];
    const delta = p5.Vector.sub(p2, p1);
    const distCurr = delta.mag();
    if (distCurr === 0) return;
    const forceMag = k * (distCurr - SPACING);
    const force = delta.copy().mult(forceMag / distCurr);
    if (isMovable(x1, y1)) acc[x1][y1].add(force);
    if (isMovable(x2, y2)) acc[x2][y2].sub(force);
}

function isMovable(x, y) { return gridStatus[x][y] && !(x === 0 || x === COLS - 1 || y === 0 || y === ROWS - 1); }

// returns true if a node was successfully dropped
function attemptDrop() {
    const offsetX = (width - NET_SIZE) / 2;
    const offsetY = (height - NET_SIZE) / 2;
    for (let tries = 0; tries < 40; tries++) {
        const x = floor(random(COLS));
        const y = floor(random(ROWS));
        if (!gridStatus[x][y]) continue;
        gridStatus[x][y] = false;
        if (isConnected()) {
            dropCount++;
            const worldPos = createVector(pos[x][y].x + offsetX, pos[x][y].y + offsetY);

            const windActive = frameCount > WIND_DELAY_FRAMES;
            const windElapsed = constrain(frameCount - WIND_DELAY_FRAMES, 0, WIND_RAMP_FRAMES);
            const currentWindStrength = windActive ? windElapsed / WIND_RAMP_FRAMES : 0;
            let velInit;
            if (windActive && currentWindStrength > 0.1) {
                velInit = p5.Vector.mult(windDir, random(3, 6) * currentWindStrength);

                velInit.y += random(1, 2);
            } else {
                velInit = createVector(random(-0.8, 0.8), random(0.5, 2));
            }
            dropped.push({ char: gridChar[x][y], pos: worldPos, vel: velInit, rot: random(TWO_PI) });
            return true;
        } else {
            gridStatus[x][y] = true;
        }
    }
    return false;
}

function isConnected() {
    const visited = Array(COLS).fill().map(() => Array(ROWS).fill(false));
    const queue = [];
    outer: for (let i = 0; i < COLS; i++) for (let j = 0; j < ROWS; j++) if (gridStatus[i][j]) { visited[i][j] = true; queue.push([i, j]); break outer; }
    if (!queue.length) return true;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (queue.length) {
        const [cx, cy] = queue.shift();
        for (const [dx, dy] of dirs) {
            const nx = cx + dx, ny = cy + dy;
            if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && gridStatus[nx][ny] && !visited[nx][ny]) { visited[nx][ny] = true; queue.push([nx, ny]); }
        }
    }
    for (let i = 0; i < COLS; i++) for (let j = 0; j < ROWS; j++) if (gridStatus[i][j] && !visited[i][j]) return false;
    return true;
}


function detectVibrationLevel(x, y) {
    const history = velHistory[x][y];
    if (history.length < VIBRATION_DETECTION_FRAMES) return 0;

    let directionChanges = 0;
    let totalMagnitudeChange = 0;

    for (let i = 1; i < history.length; i++) {
        const prevVel = history[i - 1];
        const currVel = history[i];

        if (prevVel.dot(currVel) < 0) {
            directionChanges++;
        }

        totalMagnitudeChange += abs(currVel.mag() - prevVel.mag());
    }

    const directionChangeRatio = directionChanges / (history.length - 1);
    const avgMagnitudeChange = totalMagnitudeChange / (history.length - 1);

    return directionChangeRatio * 0.7 + min(avgMagnitudeChange * 20, 1.0) * 0.3;
}

function applyLowPassFilter(x, y) {
    const history = velHistory[x][y];
    let filteredVel = createVector(0, 0);

    let totalWeight = 0;
    for (let i = 0; i < history.length; i++) {
        const weight = (i + 1) / history.length;
        filteredVel.add(p5.Vector.mult(history[i], weight));
        totalWeight += weight;
    }

    if (totalWeight > 0) {
        filteredVel.div(totalWeight);
    }

    const currentVel = vel[x][y];
    const blendFactor = SMOOTHING_FACTOR * (1 + vibrationLevel[x][y]);

    return p5.Vector.lerp(currentVel, filteredVel, blendFactor);
}
