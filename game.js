const API_URL = "https://script.google.com/macros/s/AKfycbz6vCg6M83zEaMLKjc-SeRzLtHbrGXfwcugtP5pnM5QgYb5U_9GBv1rBM81oB5HKO0M_Q/exec";
const categories1 = ["Domme", "Influencer/Brat", "Adult Star", "Celebrity", "Captions"];
const categories2 = ["Blonde", "Red", "Brunette"];

let lastRoundScore = 0;
let activeBonusValue = 0; 
let isRolling = false;
let userRole = "hero"; 

// Check URL variables immediately to enforce user roles
function checkPlayerRole() {
    const urlParams = new URLSearchParams(window.location.search);
    const roleParam = urlParams.get('role');
    
    if (roleParam === 'villainess') {
        userRole = "villainess";
        
        const indicator = document.getElementById('roleIndicator');
        indicator.innerText = "Role: Villainess (Player 2)";
        indicator.className = "role-banner villain-role";

        // Hide all interactive components for Player 2
        document.querySelectorAll('.hero-control').forEach(element => {
            element.style.display = 'none';
        });
    } else {
        userRole = "hero";
        document.getElementById('roleIndicator').innerText = "Role: Hero (Player 1)";
        // Hide Villainess setup elements from Hero view completely
        const villainSetupBox = document.getElementById('villainSetup');
        if (villainSetupBox) villainSetupBox.style.display = 'none';
    }
}

// Rebuild and update elements with sheet calculations
function updateUI(data) {
    const remHp = parseInt(data.remainingHp);
    const startHp = parseInt(data.startingHp);
    const maxRounds = parseInt(data.maxRounds) || 15; 
    const currentCurse = parseInt(data.curseAmount) || 0;

    document.getElementById('startHp').innerText = startHp;
    document.getElementById('remHp').innerText = remHp;
    document.getElementById('spin1Val').innerText = data.spinner1 || "None";
    document.getElementById('spin2Val').innerText = data.spinner2 || "None";
    document.getElementById('curseValue').innerText = currentCurse;

    // Toggle Curse Input Lock Status for Villainess
    if (userRole === "villainess") {
        const setupBox = document.getElementById('villainSetup');
        if (setupBox) {
            if (currentCurse > 0) setupBox.style.display = 'none';
            else setupBox.style.display = 'inline-flex';
        }
    }

    // Update Global Record Stats Counters
    document.getElementById('heroWinCount').innerText = data.heroWins || 0;
    document.getElementById('villainWinCount').innerText = data.villainessWins || 0;
    
    const streakCard = document.getElementById('streakCard');
    const streakDisplay = document.getElementById('streakDisplay');
    const streakWinner = data.currentStreakWinner || "None";
    const streakCount = data.currentStreakCount || 0;

    if (streakWinner === "Villainess" && streakCount > 0) {
        streakDisplay.innerText = `Villainess 🔥 ${streakCount} Wins (+${streakCount * 5} HP Catchup)`;
        if (streakCard) streakCard.style.borderColor = "#ff4757";
    } else if (streakWinner === "Hero" && streakCount > 0) {
        streakDisplay.innerText = `Hero 🌟 ${streakCount} Wins`;
        if (streakCard) streakCard.style.borderColor = "#1e90ff";
    } else {
        streakDisplay.innerText = "No Active Streak";
        if (streakCard) streakCard.style.borderColor = "#444";
    }

    // ==========================================
    // VISUAL RENDER BLOCK: THE ACTIVE COMBAT FIELD
    // ==========================================
    let fieldHtml = "";
    if (data.activeFieldCards && data.activeFieldCards.length > 0) {
        data.activeFieldCards.forEach(card => {
            let roleClass = card.role === "hero" ? "card-hero" : "card-villainess";
            fieldHtml += `
                <div class="game-card ${roleClass}">
                    <div class="card-header-title">${card.name}</div>
                    <div class="card-body-desc">${card.desc}</div>
                    <div style="font-size:0.65rem; color:#888; text-align:center;">IN PLAY</div>
                </div>
            `;
        });
    } else {
        fieldHtml = `<div class="field-placeholder">No cards activated yet for this round...</div>`;
    }
    const combatZoneEl = document.getElementById('activeCombatZone');
    if (combatZoneEl) combatZoneEl.innerHTML = fieldHtml;

    // ==========================================
    // VISUAL RENDER BLOCK: PLAYER PRIVATE HAND
    // ==========================================
    let handHtml = "";
    let currentHand = userRole === "hero" ? data.heroCards : data.villainessCards;
    
    // Check if the current round has been Silenced by the alternative player
    let isSilenced = false;
    if (data.activeFieldCards) {
        isSilenced = data.activeFieldCards.some(c => c.id === "V_TRIG");
    }

    if (currentHand && currentHand.length > 0) {
        currentHand.forEach(card => {
            let roleClass = card.role === "hero" || userRole === "hero" ? "card-hero" : "card-villainess";
            let isDisabled = card.spent || card.lockedByRound || (userRole === "hero" && isSilenced);
            let cardClass = `game-card ${roleClass}` + (isDisabled ? " disabled" : "");
            
            let stampLabel = "";
            if (card.spent) stampLabel = `<div class="card-stamp-locked">SPENT</div>`;
            else if (card.lockedByRound) stampLabel = `<div class="card-stamp-locked">LOCKED (RND)</div>`;
            else if (userRole === "hero" && isSilenced) stampLabel = `<div class="card-stamp-locked">SILENCED</div>`;

            handHtml += `
                <div class="${cardClass}">
                    ${stampLabel}
                    <div class="card-header-title">${card.name}</div>
                    <div class="card-body-desc">${card.desc}</div>
                    <button class="btn-play-card" ${isDisabled ? 'disabled' : ''} 
                        onclick="activateCard('${card.id}', '${card.effectType}', ${card.value || 0}, '${card.name.replace(/'/g, "\\'")}', '${card.desc.replace(/'/g, "\\'")}')">
                        Activate Power
                    </button>
                </div>
            `;
        });
    } else {
        handHtml = `<div class="field-placeholder">No cards assigned. Reset game to draw hands.</div>`;
    }
    const handGridEl = document.getElementById('playerHandGrid');
    if (handGridEl) handGridEl.innerHTML = handHtml;

        // ==========================================
    // MATCH PROGRESS CELLS RENDER LOOP
    // ==========================================
    let gridHtml = "";
    let finalRawBaseScore = 0;
    let nextEmptyFound = false;
    let filledCount = 0;

    for (let i = 0; i < maxRounds; i++) {
        let dmg = data.scores[i];
        let baseDmg = data.baseScores ? data.baseScores[i] : 0;
        let cellClass = "round-cell";
        let displayDmg = "-";

        if (dmg !== undefined && dmg !== "" && dmg !== null) {
            let parsedDmg = parseInt(dmg);
            if (!isNaN(parsedDmg) && parsedDmg >= 0 && data.scores[i] !== "") {
                cellClass += " filled";
                displayDmg = parsedDmg;
                finalRawBaseScore = parseInt(baseDmg) || 0; // Tracks natural base damage
                filledCount++;
            } else if (!nextEmptyFound) {
                cellClass += " active"; 
                nextEmptyFound = true;
            }
        } else if (!nextEmptyFound) {
            cellClass += " active"; 
            nextEmptyFound = true;
        }
        gridHtml += `<div class="${cellClass}"><div class="round-num">Rnd ${i + 1}</div><div class="round-dmg">${displayDmg}</div></div>`;
    }
    document.getElementById('roundGrid').innerHTML = gridHtml;

    // Control Bonus Dice Box Visibility based strictly on final base score
    if (finalRawBaseScore === 10 && userRole === "hero") {
        document.getElementById('bonusBox').style.display = 'flex';
    } else {
        document.getElementById('bonusBox').style.display = 'none';
        document.getElementById('diceElement').innerText = "?";
        activeBonusValue = 0;
    }

    // Process Endgame Condition States
    const overlay = document.getElementById('gameOverOverlay');
    const goBox = document.getElementById('gameOverBox');
    const goTitle = document.getElementById('gameOverTitle');
    const goMsg = document.getElementById('gameOverMsg');

    if (remHp <= 0) {
        overlay.style.display = 'flex';
        if (userRole === "hero") {
            goBox.className = "game-over-box loss-theme"; 
            goTitle.innerText = "Defeat!"; 
            goMsg.innerText = "Your HP fell to 0. The Villainess wins the match!";
        } else {
            goBox.className = "game-over-box win-theme"; 
            goTitle.innerText = "Victory!"; 
            goMsg.innerText = "The Hero's HP has been completely reduced to 0. You break his resolve and win!";
        }
    } 
    else if (filledCount >= maxRounds && remHp > 0) {
        overlay.style.display = 'flex';
        if (userRole === "hero") {
            goBox.className = "game-over-box win-theme"; 
            goTitle.innerText = "Victory!"; 
            goMsg.innerText = `You successfully endured all ${maxRounds} rounds with ${remHp} HP remaining. You win!`;
        } else {
            goBox.className = "game-over-box loss-theme"; 
            goTitle.innerText = "Defeat!"; 
            goMsg.innerText = `The Hero successfully survived all ${maxRounds} rounds of attacks. You lose.`;
        }
    } else { 
        overlay.style.display = 'none'; 
    }

    // Update Descending History Table
    let tableHtml = "";
    if (data.rawHistory && data.rawHistory.length > 0) {
        data.rawHistory.forEach(item => {
            let winClass = item.winner === "Hero" ? "history-winner-hero" : "history-winner-villain";
            let displayDate = String(item.date).split('T') || item.date;
            tableHtml += `<tr><td>${displayDate}</td><td class="${winClass}">${item.winner}</td><td>${item.cat1}</td><td>${item.cat2}</td><td>${item.startHp}</td><td>${item.finalHp}</td><td>${item.rounds}</td><td>+${item.curse}</td></tr>`;
        });
    } else {
        tableHtml = `<tr><td colspan="8" style="text-align:center; color:#999;">No logged matches found.</td></tr>`;
    }
    document.getElementById('historyTableBody').innerHTML = tableHtml;
}

// Simulates dynamic D6 rolling sequence for Hero 10! bonus
function rollBonusDice() {
    if (isRolling) return;
    isRolling = true;
    
    const dice = document.getElementById('diceElement');
    dice.classList.add('rolling');
    
    let intervals = setInterval(() => {
        dice.innerText = Math.floor(Math.random() * 6) + 1;
    }, 60);

    setTimeout(() => {
        clearInterval(intervals);
        dice.classList.remove('rolling');
        
        activeBonusValue = Math.floor(Math.random() * 6) + 1;
        dice.innerText = activeBonusValue;
        isRolling = false;
    }, 500);
}

// Simulates Villainess dynamic D20 curse rolling sequence
function rollCurseDice() {
    if (isRolling || userRole !== "villainess") return;
    isRolling = true;
    
    const vDice = document.getElementById('vDiceElement');
    if (!vDice) return;
    vDice.classList.add('rolling');
    
    let intervals = setInterval(() => {
        vDice.innerText = Math.floor(Math.random() * 20) + 1;
    }, 60);

    setTimeout(async () => {
        clearInterval(intervals);
        vDice.classList.remove('rolling');
        
        let rolledCurse = Math.floor(Math.random() * 20) + 1;
        vDice.innerText = rolledCurse;
        isRolling = false;
        
        try {
            let response = await fetch(API_URL, {
                method: "POST",
                body: JSON.stringify({ action: "setCurse", curse: rolledCurse })
            });
            let data = await response.json();
            updateUI(data);
        } catch (err) {
            console.error("Error setting curse value:", err);
            vDice.innerText = "d20";
        }
    }, 600);
}

// API Call: Fetch baseline state
async function fetchGameState() {
    try {
        let response = await fetch(API_URL);
        let data = await response.json();
        updateUI(data);
    } catch (err) { console.error("Error fetching state:", err); }
}

// API Call: Spin category wheels
async function spinWheels() {
    let pick1 = categories1[Math.floor(Math.random() * categories1.length)];
    let pick2 = categories2[Math.floor(Math.random() * categories2.length)];
    
    document.getElementById('spin1Val').innerText = "Spinning...";
    document.getElementById('spin2Val').innerText = "Spinning...";

    let response = await fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "updateSpinners", spinner1: pick1, spinner2: pick2 })
    });
    let data = await response.json();
    updateUI(data);
}

// API Call: Submit attack parameters
async function submitScore() {
    if (isRolling) return alert("Wait for the dice to finish rolling!");
    
    let baseScore = parseInt(document.getElementById('scoreInput').value);
    if (isNaN(baseScore) || baseScore <= 0) return alert("Enter a valid damage number");

    let finalScoreToSend = baseScore + activeBonusValue;
    document.getElementById('scoreInput').value = ""; 

    let response = await fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ 
            action: "submitScore", 
            score: finalScoreToSend, 
            baseInputScore: baseScore 
        })
    });
    let data = await response.json();
    updateUI(data);
}

// API Call: Spent Card Network Synchronization Pipeline
async function activateCard(cardId, effectType, value, name, desc) {
    let systemPayload = { action: "playCard", cardId: cardId, effectType: effectType };

    if (effectType === "HEAL_D10") {
        let healRoll = Math.floor(Math.random() * 10) + 1;
        systemPayload.calculatedRoll = healRoll;
    }

    try {
        let response = await fetch(API_URL, {
            method: "POST",
            body: JSON.stringify(systemPayload)
        });
        let data = await response.json();
        updateUI(data);

        // Quick UI adjustments on execution if matching local player attributes
        if (effectType === "SETSCORE" && document.getElementById('scoreInput')) {
            document.getElementById('scoreInput').value = value;
        }
    } catch (err) { 
        console.error("Card activation tracking connection fault:", err); 
    }
}

// API Call: Reset spreadsheet
async function confirmReset() {
    let verify = confirm("Are you sure you want to completely reset the game? This will wipe out all categories and round data.");
    if (!verify) return;

    let response = await fetch(API_URL, {
        method: "POST",
        body: JSON.stringify({ action: "resetGame" })
    });
    let data = await response.json();
    updateUI(data);
}

// Controls Modal view display bounds toggles
function toggleHistoryModal(show) {
    const modal = document.getElementById('historyModal');
    if (modal) modal.style.display = show ? 'flex' : 'none';
}

// Execute core cycles
checkPlayerRole();
setInterval(fetchGameState, 1000);
fetchGameState();
