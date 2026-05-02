function toggleTheme() {
    const body = document.body;
    const icon = document.getElementById("theme-icon");

    body.classList.toggle("light-mode");

    if (body.classList.contains("light-mode")) {
        localStorage.setItem("theme", "light");
        icon.textContent = "🌙"; // show moon
    } else {
        localStorage.setItem("theme", "dark");
        icon.textContent = "☀️"; // show sun
    }
}

window.onload = () => {
    const savedTheme = localStorage.getItem("theme");
    const icon = document.getElementById("theme-icon");

    if (savedTheme === "light") {
        document.body.classList.add("light-mode");
        icon.textContent = "🌙"; 
    } else {
        icon.textContent = "☀️";
    }
};
