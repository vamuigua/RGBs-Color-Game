//Generated Array of random colors
var colors = generateRandomColors(6);

//select all squares in the container
var squares = document.querySelectorAll(".square");
//pick a random color
var pickedColor = pickColor();
//select the colorDisplay element
var colorDisplay = document.getElementById("colorDisplay");
//display  the picked color
colorDisplay.textContent = pickedColor;
//select the message element
var messageDisplay = document.querySelector("#message");

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
            //change all the squares to the picked color
            changeColors(clickedColor);
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