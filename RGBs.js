//Number of colors to generate by default
var numSquares = 6;
//Generated Array of random colors
var colors = generateRandomColors(numSquares);
//select all squares in the container
var squares = document.querySelectorAll(".square");
//pick a random color
var pickedColor = pickColor();
//select the colorDisplay element
var colorDisplay = document.getElementById("colorDisplay");
//display color in the doc
colorDisplay.textContent = pickedColor;
//select the message element
var messageDisplay = document.querySelector("#message");
//select the h1 in the document
var h1 = document.querySelector("h1");
//reset button selector
var resetButton = document.querySelector("#reset");
//select modeButtons
var modeButtons = document.querySelectorAll(".mode");

//check which mode the player has set (EASY / HARD)
for (var i = 0; i < modeButtons.length; i++) {
    modeButtons[i].addEventListener("click", function() {
        //remove the class selected
        modeButtons[0].classList.remove("selected");
        modeButtons[1].classList.remove("selected");
        //add the class seleced
        this.classList.add("selected");
        //check which mode is choosen and give correct num of squares
        this.textContent === "Easy" ? numSquares = 3 : numSquares = 6;
        //reset the game
        reset();
    });
}

//function to reset the game
function reset() {
    //generate all new colors
    colors = generateRandomColors(numSquares);
    //pick new random color from array
    pickedColor = pickColor();
    //change colorDisplay to match picked color
    colorDisplay.textContent = pickedColor;
    //button to show new colors when player wins
    resetButton.textContent = "New Colors ";
    //message display to be empty
    messageDisplay.textContent = "";
    //change colors of squares
    for (var i = 0; i < squares.length; i++) {
        //if present give square a new color
        if (colors[i]) {
            //bt first display all colors
            squares[i].style.display = "block";
            squares[i].style.background = colors[i];
        } else {
            //else don't display them
            squares[i].style.display = "none";
        }
    }
    //change the h1 background
    h1.style.background = "steelblue";
}

//event listener for the resetbutton
resetButton.addEventListener("click", function() {
    //reset the game when the reset game is clicked
    reset();
});

//for each of the squares, give it a color
for (var i = 0; i < squares.length; i++) {
    //add initial colors to squares
    squares[i].style.background = colors[i];
    //add click listeners to squares
    squares[i].addEventListener("click", function() {
        //grab color of clicked square
        var clickedColor = this.style.background;
        //compare color of pickedColor
        if (clickedColor === pickedColor) {
            messageDisplay.textContent = "Correct!";
            resetButton.textContent = "Play Again?"
                //change all the squares to the picked color
            changeColors(clickedColor);
            //change the h1 background
            h1.style.background = pickedColor;
        } else {
            //make the wrong one have same color of the background
            this.style.background = "#232323";
            messageDisplay.textContent = "Try Again!";
        }
    });
}

//Change colors
function changeColors(color) {
    //loop through all squares
    for (var i = 0; i < squares.length; i++) {
        //change each color to match the given color
        squares[i].style.background = color;
    }
}

//Pick Color
function pickColor() {
    //choose a random color from our array of colors
    var random = Math.floor(Math.random() * colors.length);
    //return the random color
    return colors[random];
}

//Generate Random colors into array
function generateRandomColors(num) {
    //make an array
    var arr = [];
    //add num random colors in the array
    for (var i = 0; i < num; i++) {
        //get random color and push into the array
        arr.push(randomColor());
    }
    //return the array
    return arr;
}

//random color
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