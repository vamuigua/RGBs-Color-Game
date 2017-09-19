//Array of colors
var colors = [
    "rgb(255, 0, 0)",
    "rgb(255, 255 ,0)",
    "rgb(0, 255 ,0)",
    "rgb(0, 255, 255)",
    "rgb(0, 0, 255)",
    "rgb(255, 0, 255)"
]

//select all squares in the container
var squares = document.querySelectorAll(".square");
var pickedColor = colors[3];
var colorDisplay = document.getElementById("colorDisplay");

colorDisplay.textContent = pickedColor;

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
            alert("Correct!");
        } else {
            //make the wrong one have same color of the background
            this.style.background = "#232323";
        }
    });
}