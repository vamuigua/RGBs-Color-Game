// number of colors to generate by default
var numSquares = 6;
// stores the generated random colors
var colors = [];
// stores the correct color
var pickedColor;
// select all squares in the container
var squares = document.querySelectorAll(".square");
//select the colorDisplay element
var colorDisplay = document.getElementById("colorDisplay");
// select the message element
var messageDisplay = document.querySelector("#message");
// select the h1 element
var h1 = document.querySelector("h1");
// select the reset button
var resetButton = document.querySelector("#reset");
//select all mode buttons
var modeButtons = document.querySelectorAll(".mode");

var correctMsg = document.querySelector("#correctMsg");
var wrongMsg = document.querySelector("#wrongMsg");

var resetAudio = document.getElementById("resetAudio");
var positiveAudio = document.getElementById("positiveAudio");
var negativeAudio = document.getElementById("negativeAudio");

//function to run at the beginning
init();

function init() {
	setupModeButtons();
	setupSquares();
	reset();
}

// Setup the Game Mode Buttons
function setupModeButtons() {
	// check which mode the player has set (EASY / HARD)
	for (var i = 0; i < modeButtons.length; i++) {
		modeButtons[i].addEventListener("click", function () {
			// remove the 'active' class from each mode button
			modeButtons[0].classList.remove("active");
			modeButtons[1].classList.remove("active");
			modeButtons[2].classList.remove("active");

			//add the 'active' class to the clicked button
			this.classList.add("active");

			// check which mode of the clicked button & give correct num of squares
			switch (this.textContent) {
				case "Easy":
					numSquares = 3;
					break;
				case "Medium":
					numSquares = 6;
					break;
				default:
					numSquares = 9;
					break;
			}

			// reset the game
			reset();
		});
	}
}

// Setup the Squares
function setupSquares() {
	for (var i = 0; i < squares.length; i++) {
		squares[i].addEventListener("click", function () {
			// grab bg color of clicked square
			var clickedColor = this.style.background;
			if (clickedColor === pickedColor) {
				messageDisplay.parentElement.className = "";
				messageDisplay.parentElement.classList.add("stripe-correct");
				messageDisplay.textContent = "Correct!";
				positiveAudio.play();
				resetButton.textContent = "Play Again?";
				animateCSS("#message", "bounceIn");
				// change bg color of all squares to the picked color
				changeColors(clickedColor);
				h1.style.background = pickedColor;
			} else {
				// make the selected square have same color of the bg
				this.style.background = "#232323"; // dark greyish colory
				this.style.visibility = "hidden";
				messageDisplay.parentElement.className = "";
				messageDisplay.parentElement.classList.add("stripe-wrong");
				messageDisplay.textContent = "Try Again!";
				negativeAudio.play();
				// Play some animations
				animateCSS("#message", "headShake").then((msg) => {
					animateCSS(".stripe-wrong", "fadeOut").then((msg) => {
						messageDisplay.textContent = "";
						messageDisplay.parentElement.className = "";
						messageDisplay.parentElement.classList.add("stripe");
					});
				});
			}
		});
	}
}

// Resets the game
function reset() {
	resetAudio.play();
	// generate all new colors for 'numSquares'
	colors = generateRandomColors(numSquares);
	// pick new random color from array (The correct color)
	pickedColor = pickColor();
	// change colorDisplay text to match picked color
	colorDisplay.textContent = "Find: " + pickedColor;
	animateCSS("#colorDisplay", "backInLeft").then((msg) => {
		animateCSS("#colorDisplay", "flash");
	});
	// button to show new colors on reset
	resetButton.textContent = "New Colors";
	// message display to be empty
	messageDisplay.textContent = "";
	messageDisplay.parentElement.className = "";
	messageDisplay.parentElement.classList.add("stripe");

	// change colors of squares & display style
	for (var i = 0; i < squares.length; i++) {
		// if color[i] exists,
		if (colors[i]) {
			// make square[i] visible
			squares[i].style.visibility = "visible";
			squares[i].style.display = "block";
			// then add bg color to square[i]
			squares[i].style.background = colors[i];
		} else {
			// else don't display them
			squares[i].style.display = "none";
		}
	}

	// change the h1 background color
	h1.removeAttribute("style");
	h1.classList.add("cool-gradient");
}

//reset the game when the 'Play again' or 'New Colors' button is clicked
resetButton.addEventListener("click", function () {
	reset();
});

//Loop through all squares to match the correct color
function changeColors(color) {
	for (var i = 0; i < squares.length; i++) {
		squares[i].style.visibility = "visible";
		squares[i].style.background = color;
	}
}

//Selectes a random color from our array of colors
function pickColor() {
	var random = Math.floor(Math.random() * colors.length);
	return colors[random];
}

//Generates Random colors and stores them in an array
function generateRandomColors(num) {
	var arr = [];
	//add 'num' random colors into array
	for (var i = 0; i < num; i++) {
		arr.push(randomColor());
	}
	return arr;
}

//Create a random rgb color
function randomColor() {
	//pick a "red" from 0 - 255
	var r = Math.floor(Math.random() * 256);
	//pick a "green" from 0 - 255
	var g = Math.floor(Math.random() * 256);
	//pick a "blue" from 0 - 255
	var b = Math.floor(Math.random() * 256);
	//put random color in rgb format
	return "rgb(" + r + ", " + g + ", " + b + ")";
}
